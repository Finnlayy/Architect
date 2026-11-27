import fs from 'fs';
import path from 'path';
import net from 'net';
import tls from 'tls';

export const PAPER_BOOK_DEFAULT_CAPITAL = 100.0;
const LAKE_KEY_PREFIX = 'omega:paper_book:';
const LAKE_SNAPSHOT_PATH = path.resolve(process.cwd(), '.omega_redis_paper_lake.json');

export interface PaperBookPosition {
  pair: string;
  type: 'buy' | 'sell';
  side?: 'LONG' | 'SHORT';
  vol: number;
  volume?: number;
  cost: number;
  entry_price: number;
  current_price: number;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
  opened_at?: number;
  opened_at_formatted?: string;
  txid?: string;
}

export interface PaperBookHistoryEntry {
  txid: string;
  time: number;
  pair: string;
  type: 'buy' | 'sell';
  price: number;
  vol: number;
  cost: number;
  fee: number;
  status: 'filled';
}

export interface PaperBookBracket {
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  isBreakEven: boolean;
  side: 'LONG' | 'SHORT';
}

export interface StrategyPaperBook {
  strategyId: string;
  redisKey: string;
  current_value: number;
  initial_balance: number;
  cash: number;
  unrealized_pnl: number;
  realized_pnl: number;
  total_pnl: number;
  trades_count: number;
  positions: PaperBookPosition[];
  history: PaperBookHistoryEntry[];
  openOrders: any[];
  brackets: Record<string, PaperBookBracket>;
  updatedAt: number;
}

export function sanitizeStrategyId(rawId?: string): string {
  const cleaned = String(rawId || 'default')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64);
  return cleaned || 'default';
}

function buildRedisKey(strategyId: string): string {
  return `${LAKE_KEY_PREFIX}${sanitizeStrategyId(strategyId)}`;
}

function clampInitialCapital(val?: number): number {
  const num = Number(val);
  if (!Number.isFinite(num) || num < 10) return PAPER_BOOK_DEFAULT_CAPITAL;
  return Math.round(num * 100) / 100;
}

function createEmptyBook(strategyId: string, initialBalance: number = PAPER_BOOK_DEFAULT_CAPITAL): StrategyPaperBook {
  const sid = sanitizeStrategyId(strategyId);
  const cap = clampInitialCapital(initialBalance);
  return {
    strategyId: sid,
    redisKey: buildRedisKey(sid),
    current_value: cap,
    initial_balance: cap,
    cash: cap,
    unrealized_pnl: 0.0,
    realized_pnl: 0.0,
    total_pnl: 0.0,
    trades_count: 0,
    positions: [],
    history: [],
    openOrders: [],
    brackets: {},
    updatedAt: Date.now(),
  };
}

// ============================================================================
// OPTIONAL EXTERNAL REDIS RESP2 CLIENT (WHEN process.env.REDIS_URL IS SET)
// ============================================================================
function encodeRespCommand(args: string[]): string {
  let out = `*${args.length}\r\n`;
  for (const arg of args) {
    const buf = Buffer.from(arg, 'utf8');
    out += `$${buf.length}\r\n${arg}\r\n`;
  }
  return out;
}

async function execRedisCommand(args: string[]): Promise<string | null> {
  const redisUrlRaw = (process.env.REDIS_URL || '').trim();
  if (!redisUrlRaw) return null;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(redisUrlRaw);
  } catch {
    return null;
  }

  const isTls = parsedUrl.protocol === 'rediss:';
  const host = parsedUrl.hostname || '127.0.0.1';
  const port = Number(parsedUrl.port) || 6379;
  const password = parsedUrl.password ? decodeURIComponent(parsedUrl.password) : '';
  const dbIndex = parsedUrl.pathname && parsedUrl.pathname.length > 1
    ? Number(parsedUrl.pathname.slice(1))
    : 0;

  return new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (val: string | null) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolve(val);
    };

    const socket = isTls
      ? tls.connect({ host, port, servername: host })
      : net.connect({ host, port });

    socket.setTimeout(1800);
    socket.on('timeout', () => finish(null));
    socket.on('error', () => finish(null));

    let buffer = '';
    const cmds: string[][] = [];
    if (password) cmds.push(['AUTH', password]);
    if (Number.isInteger(dbIndex) && dbIndex > 0) cmds.push(['SELECT', String(dbIndex)]);
    cmds.push(args);

    socket.on('connect', () => {
      socket.write(cmds.map(encodeRespCommand).join(''));
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n');
      // Wait for at least one complete RESP response per pipelined command
      if (lines.length < cmds.length + 1) return;

      // Extract the final command's reply
      const lastNonEmptyIdx = lines.length - 2;
      if (lastNonEmptyIdx < 0) return;
      const lastLine = lines[lastNonEmptyIdx];
      if (lastLine.startsWith('+') || lastLine.startsWith(':')) {
        finish(lastLine.slice(1));
      } else if (lastLine === '$-1') {
        finish(null);
      } else {
        // Bulk string: find final $len header
        const dollarIdx = buffer.lastIndexOf('\r\n$');
        if (dollarIdx >= 0 || buffer.startsWith('$')) {
          const start = dollarIdx >= 0 ? dollarIdx + 2 : 0;
          const headerEnd = buffer.indexOf('\r\n', start);
          if (headerEnd > start) {
            const len = Number(buffer.slice(start + 1, headerEnd));
            if (Number.isFinite(len) && len >= 0) {
              const payloadStart = headerEnd + 2;
              if (buffer.length >= payloadStart + len + 2) {
                finish(buffer.slice(payloadStart, payloadStart + len));
              }
            }
          }
        }
      }
    });
  });
}

// ============================================================================
// EMBEDDED REDIS-COMPATIBLE KEY-VALUE DATA LAKE (WITH ATOMIC DISK SNAPSHOT)
// ============================================================================
const MAX_LAKE_BOOKS = 40;
const MAX_BRACKETS_PER_BOOK = 60;
const MAX_POSITIONS_PER_BOOK = 40;
const MAX_OPEN_ORDERS_PER_BOOK = 50;
const MAX_HISTORY_PER_BOOK = 100;

const lakeStore = new Map<string, StrategyPaperBook>();
let lakeLoaded = false;
let persistTimer: NodeJS.Timeout | null = null;
let persistInFlight = false;
let persistQueued = false;

function capBookStructures(book: StrategyPaperBook): StrategyPaperBook {
  if (Array.isArray(book.history) && book.history.length > MAX_HISTORY_PER_BOOK) {
    book.history.length = MAX_HISTORY_PER_BOOK;
  }
  if (Array.isArray(book.positions) && book.positions.length > MAX_POSITIONS_PER_BOOK) {
    book.positions.length = MAX_POSITIONS_PER_BOOK;
  }
  if (Array.isArray(book.openOrders) && book.openOrders.length > MAX_OPEN_ORDERS_PER_BOOK) {
    book.openOrders.length = MAX_OPEN_ORDERS_PER_BOOK;
  }
  if (book.brackets && typeof book.brackets === 'object') {
    const keys = Object.keys(book.brackets);
    if (keys.length > MAX_BRACKETS_PER_BOOK) {
      const excess = keys.length - MAX_BRACKETS_PER_BOOK;
      for (let i = 0; i < excess; i++) {
        delete book.brackets[keys[i]];
      }
    }
  }
  return book;
}

function setLakeBookLru(key: string, book: StrategyPaperBook): void {
  capBookStructures(book);
  if (lakeStore.has(key)) {
    lakeStore.delete(key);
  }
  lakeStore.set(key, book);
  while (lakeStore.size > MAX_LAKE_BOOKS) {
    const oldestKey = lakeStore.keys().next().value;
    if (!oldestKey) break;
    if (oldestKey === `${LAKE_KEY_PREFIX}default` && lakeStore.size > 1) {
      // Keep default book hot at tail while evicting next oldest
      const def = lakeStore.get(oldestKey);
      lakeStore.delete(oldestKey);
      if (def) lakeStore.set(oldestKey, def);
      continue;
    }
    lakeStore.delete(oldestKey);
  }
}

function loadLakeFromDisk(): void {
  if (lakeLoaded) return;
  lakeLoaded = true;
  try {
    if (fs.existsSync(LAKE_SNAPSHOT_PATH)) {
      const raw = fs.readFileSync(LAKE_SNAPSHOT_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.books === 'object' && parsed.books !== null) {
        for (const [k, v] of Object.entries(parsed.books)) {
          if (v && typeof v === 'object') {
            const book = v as StrategyPaperBook;
            const sid = sanitizeStrategyId(book.strategyId || k.replace(LAKE_KEY_PREFIX, ''));
            setLakeBookLru(buildRedisKey(sid), {
              ...createEmptyBook(sid, book.initial_balance),
              ...book,
              strategyId: sid,
              redisKey: buildRedisKey(sid),
              brackets: book.brackets && typeof book.brackets === 'object' ? book.brackets : {},
              positions: Array.isArray(book.positions) ? book.positions.slice(0, MAX_POSITIONS_PER_BOOK) : [],
              openOrders: Array.isArray(book.openOrders) ? book.openOrders.slice(0, MAX_OPEN_ORDERS_PER_BOOK) : [],
              history: Array.isArray(book.history) ? book.history.slice(0, MAX_HISTORY_PER_BOOK) : [],
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn('[RedisPaperLake] Could not read lake snapshot:', err);
  }
}

async function flushLakeToDiskAsync(): Promise<void> {
  if (persistInFlight) {
    persistQueued = true;
    return;
  }
  persistInFlight = true;
  try {
    do {
      persistQueued = false;
      const booksObj: Record<string, StrategyPaperBook> = {};
      for (const [key, book] of lakeStore.entries()) {
        capBookStructures(book);
        booksObj[key] = book;
      }
      const payload = JSON.stringify({
        version: 1,
        updatedAt: Date.now(),
        books: booksObj,
      });
      const tmpPath = `${LAKE_SNAPSHOT_PATH}.tmp`;
      await fs.promises.writeFile(tmpPath, payload, 'utf8');
      await fs.promises.rename(tmpPath, LAKE_SNAPSHOT_PATH);
    } while (persistQueued);
  } catch (err) {
    console.warn('[RedisPaperLake] Could not persist lake snapshot:', err);
  } finally {
    persistInFlight = false;
  }
}

function schedulePersistLakeToDisk(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void flushLakeToDiskAsync();
  }, 750);
  if (typeof persistTimer.unref === 'function') {
    persistTimer.unref();
  }
}

export function getOrCreateStrategyPaperBook(
  strategyId?: string,
  defaultInitialBalance: number = PAPER_BOOK_DEFAULT_CAPITAL
): StrategyPaperBook {
  loadLakeFromDisk();
  const sid = sanitizeStrategyId(strategyId);
  const key = buildRedisKey(sid);
  let existing = lakeStore.get(key);
  if (!existing) {
    existing = createEmptyBook(sid, defaultInitialBalance);
    setLakeBookLru(key, existing);
    schedulePersistLakeToDisk();
    if (process.env.REDIS_URL) {
      void execRedisCommand(['SET', key, JSON.stringify(existing)]);
    }
  } else {
    // O(1) LRU touch
    lakeStore.delete(key);
    lakeStore.set(key, existing);
  }
  return existing;
}

export async function hydrateStrategyBookFromExternalRedis(strategyId?: string): Promise<void> {
  if (!process.env.REDIS_URL) return;
  loadLakeFromDisk();
  const key = buildRedisKey(sanitizeStrategyId(strategyId));
  const raw = await execRedisCommand(['GET', key]);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as StrategyPaperBook;
      if (parsed && typeof parsed.cash === 'number') {
        setLakeBookLru(key, {
          ...createEmptyBook(parsed.strategyId, parsed.initial_balance),
          ...parsed,
          redisKey: key,
        });
      }
    } catch {
      // ignore malformed remote payload
    }
  }
}

export function saveStrategyPaperBook(book: StrategyPaperBook): StrategyPaperBook {
  loadLakeFromDisk();
  const sid = sanitizeStrategyId(book.strategyId);
  const key = buildRedisKey(sid);
  const normalized: StrategyPaperBook = capBookStructures({
    ...book,
    strategyId: sid,
    redisKey: key,
    history: Array.isArray(book.history) ? book.history.slice(0, MAX_HISTORY_PER_BOOK) : [],
    updatedAt: Date.now(),
  });
  setLakeBookLru(key, normalized);
  schedulePersistLakeToDisk();
  if (process.env.REDIS_URL) {
    void execRedisCommand(['SET', key, JSON.stringify(normalized)]);
  }
  return normalized;
}

export function resetStrategyPaperBook(
  strategyId?: string,
  initialBalance: number = PAPER_BOOK_DEFAULT_CAPITAL
): StrategyPaperBook {
  loadLakeFromDisk();
  const sid = sanitizeStrategyId(strategyId);
  const fresh = createEmptyBook(sid, initialBalance);
  setLakeBookLru(fresh.redisKey, fresh);
  schedulePersistLakeToDisk();
  if (process.env.REDIS_URL) {
    void execRedisCommand(['SET', fresh.redisKey, JSON.stringify(fresh)]);
  }
  return fresh;
}

export function updateStrategyPaperBookCapital(
  strategyId: string | undefined,
  newInitialCapital: number
): StrategyPaperBook {
  const book = getOrCreateStrategyPaperBook(strategyId, newInitialCapital);
  const nextCap = clampInitialCapital(newInitialCapital);
  const oldCap = book.initial_balance;

  if (book.trades_count === 0 && book.positions.length === 0) {
    book.initial_balance = nextCap;
    book.cash = nextCap;
    book.current_value = nextCap;
    book.unrealized_pnl = 0;
    book.realized_pnl = 0;
    book.total_pnl = 0;
  } else if (Math.abs(nextCap - oldCap) > 0.001) {
    const delta = nextCap - oldCap;
    book.initial_balance = nextCap;
    book.cash = Math.max(0, Number((book.cash + delta).toFixed(2)));
    book.current_value = Math.max(0, Number((book.current_value + delta).toFixed(2)));
  }

  return saveStrategyPaperBook(book);
}

export function setStrategyPaperBracket(
  strategyId: string | undefined,
  pair: string,
  bracket: PaperBookBracket
): StrategyPaperBook {
  const book = getOrCreateStrategyPaperBook(strategyId);
  const cleanPair = String(pair || '').toUpperCase().trim().slice(0, 32);
  if (cleanPair) {
    if (Object.prototype.hasOwnProperty.call(book.brackets, cleanPair)) {
      delete book.brackets[cleanPair];
    }
    book.brackets[cleanPair] = bracket;
  }
  return saveStrategyPaperBook(book);
}

export function deleteStrategyPaperBracket(
  strategyId: string | undefined,
  pair: string
): StrategyPaperBook {
  const book = getOrCreateStrategyPaperBook(strategyId);
  const cleanPair = String(pair || '').toUpperCase().trim().slice(0, 32);
  if (cleanPair && book.brackets[cleanPair]) {
    delete book.brackets[cleanPair];
  }
  return saveStrategyPaperBook(book);
}

export function listAllStrategyPaperBooks(): StrategyPaperBook[] {
  loadLakeFromDisk();
  return Array.from(lakeStore.values());
}

export function pruneRedisPaperLakeCache(aggressive = false): number {
  let pruned = 0;
  const targetMax = aggressive ? 12 : MAX_LAKE_BOOKS;
  while (lakeStore.size > targetMax) {
    const oldestKey = lakeStore.keys().next().value;
    if (!oldestKey) break;
    if (oldestKey === `${LAKE_KEY_PREFIX}default` && lakeStore.size > 1) {
      const def = lakeStore.get(oldestKey);
      lakeStore.delete(oldestKey);
      if (def) lakeStore.set(oldestKey, def);
      continue;
    }
    lakeStore.delete(oldestKey);
    pruned++;
  }
  for (const book of lakeStore.values()) {
    capBookStructures(book);
  }
  return pruned;
}

export function getRedisLakeMeta() {
  loadLakeFromDisk();
  return {
    backend: (process.env.REDIS_URL || '').trim() ? 'REDIS_RESP' : 'EMBEDDED_REDIS_LAKE',
    keyPrefix: LAKE_KEY_PREFIX,
    booksCount: lakeStore.size,
    maxBooksInMemory: MAX_LAKE_BOOKS,
    strategyIds: Array.from(lakeStore.values()).map((b) => b.strategyId),
  };
}
