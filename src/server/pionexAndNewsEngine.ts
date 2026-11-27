/**
 * OMEGA NIO — Pionex USDT Universe Scanner (@pionex/pionex-ai-kit) & Yahoo/MSN Finance News Engine
 *
 * Security safeguards:
 *  - Outbound HTTP requests are restricted strictly to a hardcoded HTTPS host allowlist (SSRF guard).
 *  - XML/HTML feed fragments are sanitized, decoded safely, length-capped, and validated before leaving server.
 *  - No exchange credentials or private API keys are exposed to the client.
 */
import fs from 'fs';
import path from 'path';
import {
  ChronicleAnomalyEvent,
  FinanceNewsItem,
  FinanceNewsPayload,
  FinanceNewsProvider,
  OHLCVCandle,
  PionexMarketTicker,
  PionexSignalTag,
  PionexUniversePayload,
  TimeframeId,
} from '../types/terminal.ts';

const ALLOWED_EXTERNAL_HOSTS = new Set<string>([
  'api.pionex.com',
  'feeds.finance.yahoo.com',
  'query1.finance.yahoo.com',
  'finance.yahoo.com',
  'assets.msn.com',
  'www.bing.com',
]);

const PIONEX_CACHE_TTL_MS = 20_000;
const NEWS_CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 4_500;

let cachedPionexPayload: PionexUniversePayload | null = null;
let cachedPionexAt = 0;
let inflightPionexScan: Promise<PionexUniversePayload> | null = null;

let cachedNewsPayload: FinanceNewsPayload | null = null;
let cachedNewsAt = 0;
let inflightNewsFetch: Promise<FinanceNewsPayload> | null = null;

let cachedAiKitMeta: {
  installed: boolean;
  globalCliReady: boolean;
  version: string | null;
} | null = null;

function assertAllowlistedHttpsUrl(rawUrl: string): URL {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'https:' || !ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname)) {
    throw new Error(`Blocked non-allowlisted external host: ${parsed.hostname}`);
  }
  return parsed;
}

async function fetchAllowlistedText(rawUrl: string): Promise<string> {
  const safeUrl = assertAllowlistedHttpsUrl(rawUrl);
  const res = await fetch(safeUrl.toString(), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      Accept: 'application/json, application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
    },
  });
  if (!res.ok) {
    throw new Error(`Upstream HTTP ${res.status} (${safeUrl.hostname})`);
  }
  return res.text();
}

async function fetchAllowlistedJson<T = any>(rawUrl: string): Promise<T> {
  const text = await fetchAllowlistedText(rawUrl);
  return JSON.parse(text) as T;
}

export function getPionexAiKitStatus(): {
  installed: boolean;
  globalCliReady: boolean;
  version: string | null;
} {
  if (cachedAiKitMeta) return cachedAiKitMeta;
  let installed = false;
  let version: string | null = null;
  let globalCliReady = false;

  try {
    const pkgPath = path.join(
      process.cwd(),
      'node_modules',
      '@pionex',
      'pionex-ai-kit',
      'package.json'
    );
    if (fs.existsSync(pkgPath)) {
      const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      installed = true;
      version = typeof parsed.version === 'string' ? parsed.version : null;
    }
  } catch {
    installed = false;
  }

  try {
    globalCliReady =
      fs.existsSync('/usr/local/bin/pionex-ai-kit') ||
      fs.existsSync(path.join(process.cwd(), 'node_modules', '.bin', 'pionex-ai-kit'));
  } catch {
    globalCliReady = false;
  }

  cachedAiKitMeta = { installed, globalCliReady, version };
  return cachedAiKitMeta;
}

function formatHms(ts: number): string {
  return new Date(ts).toTimeString().split(' ')[0];
}

function stableHash(input: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = Number(dec);
      return code >= 32 && code <= 126 ? String.fromCharCode(code) : ' ';
    });
}

function sanitizeFeedText(raw: string, maxLen: number): string {
  return decodeXmlEntities(raw)
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function sanitizeExternalArticleLink(rawLink: string, provider: FinanceNewsProvider): string {
  const decoded = decodeXmlEntities(rawLink).trim();
  const fallback =
    provider === 'YAHOO_FINANCE'
      ? 'https://finance.yahoo.com/'
      : 'https://www.msn.com/en-us/money';

  try {
    const parsed = new URL(decoded);
    // Unwrap Bing RSS apiclick redirect to direct https target when safe
    if (parsed.hostname.includes('bing.com')) {
      const inner = parsed.searchParams.get('url');
      if (inner) {
        const innerParsed = new URL(inner);
        if (innerParsed.protocol === 'https:') {
          return innerParsed.toString();
        }
      }
    }
    if (parsed.protocol === 'https:') {
      return parsed.toString();
    }
    if (parsed.protocol === 'http:' && parsed.hostname.endsWith('yahoo.com')) {
      parsed.protocol = 'https:';
      return parsed.toString();
    }
  } catch {
    return fallback;
  }
  return fallback;
}

function inferNewsSymbol(text: string): string {
  const upper = text.toUpperCase();
  if (/\b(BITCOIN|BTC)\b/.test(upper)) return 'BTC/USD';
  if (/\b(ETHEREUM|ETH)\b/.test(upper)) return 'ETH/USD';
  if (/\b(SOLANA|SOL)\b/.test(upper)) return 'SOL/USD';
  if (/\b(XRP|RIPPLE)\b/.test(upper)) return 'XRP/USD';
  if (/\b(DOGE|DOGECOIN)\b/.test(upper)) return 'DOGE/USD';
  if (/\b(NVIDIA|NVDA)\b/.test(upper)) return 'NVDA';
  if (/\b(APPLE|AAPL)\b/.test(upper)) return 'AAPL';
  if (/\b(TESLA|TSLA)\b/.test(upper)) return 'TSLA';
  if (/\b(MICROSOFT|MSFT)\b/.test(upper)) return 'MSFT';
  if (/\b(COINBASE|COIN)\b/.test(upper)) return 'COIN';
  if (/\b(S&P|SPX|SPY|NASDAQ|DOW|WALL STREET|STOCKS)\b/.test(upper)) return 'SPY';
  if (/\b(GOLD|XAU)\b/.test(upper)) return 'XAU/USD';
  if (/\b(FED|FOMC|INFLATION|CPI|TREASURY|RATE|POWELL)\b/.test(upper)) return 'MACRO';
  return 'CRYPTO';
}

function inferNewsSentiment(text: string): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  const lower = text.toLowerCase();
  const bullHits = (
    lower.match(
      /\b(surge|rally|soar|record|gain|gains|bullish|approval|approved|inflow|adoption|breakout|jump|jumps|boom|higher|upside|upgrade|beat)\b/g
    ) || []
  ).length;
  const bearHits = (
    lower.match(
      /\b(crash|plunge|drop|drops|selloff|sell-off|bearish|ban|hack|exploit|outflow|fall|falls|slump|decline|downside|warning|risk|fear|lawsuit|downgrade|miss)\b/g
    ) || []
  ).length;

  if (bullHits > bearHits) return 'BULLISH';
  if (bearHits > bullHits) return 'BEARISH';
  return 'NEUTRAL';
}

// ============================================================================
// 1. PIONEX PUBLIC UNIVERSE SCANNER (ALL ACTIVE USDT SPOT & PERP MARKETS)
// ============================================================================

export function canonicalizePionexSymbol(
  pionexSymbol: string,
  marketType: 'SPOT' | 'PERP'
): { canonicalSymbol: string; baseAsset: string } {
  const clean = pionexSymbol.toUpperCase();
  if (marketType === 'PERP' || clean.endsWith('_USDT_PERP')) {
    const base = clean.replace(/_USDT_PERP$/, '').replace(/_/g, '');
    return {
      canonicalSymbol: `${base}USDT.P`,
      baseAsset: base,
    };
  }
  const base = clean.replace(/_USDT$/, '').replace(/_/g, '');
  return {
    canonicalSymbol: `${base}/USDT`,
    baseAsset: base,
  };
}

export function toPionexApiSymbol(rawSymbol: string): {
  pionexSymbol: string;
  marketType: 'SPOT' | 'PERP';
} | null {
  const cleaned = (rawSymbol || '').trim().toUpperCase();
  if (!cleaned) return null;

  if (cleaned.endsWith('_USDT_PERP')) {
    return { pionexSymbol: cleaned, marketType: 'PERP' };
  }
  if (cleaned.endsWith('_USDT')) {
    return { pionexSymbol: cleaned, marketType: 'SPOT' };
  }
  if (cleaned.endsWith('USDT.P')) {
    const base = cleaned.slice(0, -6).replace(/[^A-Z0-9]/g, '');
    if (!base) return null;
    return { pionexSymbol: `${base}_USDT_PERP`, marketType: 'PERP' };
  }
  if (cleaned.endsWith('/USDT')) {
    const base = cleaned.slice(0, -5).replace(/[^A-Z0-9]/g, '');
    if (!base) return null;
    return { pionexSymbol: `${base}_USDT`, marketType: 'SPOT' };
  }
  if (cleaned.endsWith('/USD')) {
    const base = cleaned.slice(0, -4).replace(/[^A-Z0-9]/g, '');
    if (!base) return null;
    return { pionexSymbol: `${base}_USDT`, marketType: 'SPOT' };
  }
  if (cleaned.endsWith('USDT')) {
    const base = cleaned.slice(0, -4).replace(/[^A-Z0-9]/g, '');
    if (!base) return null;
    return { pionexSymbol: `${base}_USDT`, marketType: 'SPOT' };
  }
  return null;
}

function parsePionexTickerRows(
  rawList: any[],
  marketType: 'SPOT' | 'PERP'
): PionexMarketTicker[] {
  const validRows: PionexMarketTicker[] = [];
  const suffix = marketType === 'PERP' ? '_USDT_PERP' : '_USDT';

  // Compute median amount for relative activity baseline
  const amounts = rawList
    .filter((r) => typeof r?.symbol === 'string' && r.symbol.endsWith(suffix))
    .map((r) => parseFloat(r.amount || '0'))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  const medianAmount = amounts.length > 0 ? amounts[Math.floor(amounts.length / 2)] : 250_000;
  const baseline = Math.max(50_000, medianAmount);

  for (const row of rawList) {
    const symbol = typeof row?.symbol === 'string' ? row.symbol.toUpperCase() : '';
    if (!symbol.endsWith(suffix)) continue;

    const price = parseFloat(row.close || '0');
    const open24h = parseFloat(row.open || '0') || price;
    const high24h = Math.max(price, parseFloat(row.high || '0') || price);
    const low24h = Math.min(price, parseFloat(row.low || '0') || price);
    const volume24hBase = parseFloat(row.volume || '0');
    const amount24hUsd = parseFloat(row.amount || '0');
    const tradeCount24h = Number(row.count || 0);
    const updatedAt = Number(row.time || Date.now());

    if (!Number.isFinite(price) || price <= 0) continue;
    if (!Number.isFinite(amount24hUsd) || amount24hUsd <= 0) continue;

    const change24hPct = open24h > 0 ? ((price - open24h) / open24h) * 100 : 0;
    const rangePct = low24h > 0 ? ((high24h - low24h) / low24h) * 100 : 0;
    const posInRange = high24h > low24h ? (price - low24h) / (high24h - low24h) : 0.5;

    // Relative volume & momentum velocity score
    const volRatio = Math.log10(Math.max(1, amount24hUsd / baseline) + 1) * 1.45;
    const impulseFactor = Math.min(2.2, Math.abs(change24hPct) / 4.2 + rangePct / 12);
    const rvolScore = Number(Math.max(0.4, volRatio + impulseFactor).toFixed(2));

    let signalTag: PionexSignalTag = 'NORMAL';
    if (marketType === 'PERP' && rvolScore >= 2.25 && Math.abs(change24hPct) >= 3.0) {
      signalTag = 'PERP SURGE';
    } else if (change24hPct >= 5.5 && amount24hUsd >= 150_000) {
      signalTag = 'TOP GAINER';
    } else if (change24hPct <= -5.5 && amount24hUsd >= 150_000) {
      signalTag = 'TOP LOSER';
    } else if (rvolScore >= 2.4 && amount24hUsd >= 250_000) {
      signalTag = 'PIONEX RVOL';
    } else if ((posInRange >= 0.94 || posInRange <= 0.06) && amount24hUsd >= 400_000) {
      signalTag = 'BREAKOUT';
    }

    const { canonicalSymbol, baseAsset } = canonicalizePionexSymbol(symbol, marketType);

    validRows.push({
      symbol,
      canonicalSymbol,
      baseAsset,
      marketType,
      price,
      open24h,
      high24h,
      low24h,
      change24hPct: Number(change24hPct.toFixed(2)),
      rangePct: Number(rangePct.toFixed(2)),
      volume24hBase: Number.isFinite(volume24hBase) ? volume24hBase : 0,
      amount24hUsd: Math.round(amount24hUsd),
      tradeCount24h: Number.isFinite(tradeCount24h) ? tradeCount24h : 0,
      rvolScore,
      signalTag,
      updatedAt,
    });
  }

  return validRows;
}

export async function scanPionexUniverse(force = false): Promise<PionexUniversePayload> {
  const now = Date.now();
  if (!force && cachedPionexPayload && now - cachedPionexAt < PIONEX_CACHE_TTL_MS) {
    return {
      ...cachedPionexPayload,
      sourceMode: 'PIONEX_CACHED',
    };
  }

  if (inflightPionexScan) {
    return inflightPionexScan;
  }

  inflightPionexScan = (async () => {
    const startMs = Date.now();
    const aiKit = getPionexAiKitStatus();

    try {
      const [spotJson, perpJson] = await Promise.all([
        fetchAllowlistedJson<any>('https://api.pionex.com/api/v1/market/tickers?type=SPOT').catch(
          () => null
        ),
        fetchAllowlistedJson<any>('https://api.pionex.com/api/v1/market/tickers?type=PERP').catch(
          () => null
        ),
      ]);

      const spotRaw = Array.isArray(spotJson?.data?.tickers) ? spotJson.data.tickers : [];
      const perpRaw = Array.isArray(perpJson?.data?.tickers) ? perpJson.data.tickers : [];

      const spotTickers = parsePionexTickerRows(spotRaw, 'SPOT');
      const perpTickers = parsePionexTickerRows(perpRaw, 'PERP');

      const combined = [...spotTickers, ...perpTickers].sort(
        (a, b) => b.amount24hUsd - a.amount24hUsd
      );

      if (combined.length === 0 && cachedPionexPayload) {
        return { ...cachedPionexPayload, sourceMode: 'PIONEX_CACHED' };
      }

      const payload: PionexUniversePayload = {
        sourceMode: 'PIONEX_PUBLIC_API',
        aiKitInstalled: aiKit.installed,
        aiKitGlobalCliReady: aiKit.globalCliReady,
        aiKitVersion: aiKit.version,
        totalUsdtMarkets: combined.length,
        spotCount: spotTickers.length,
        perpCount: perpTickers.length,
        anomaliesCount: combined.filter((t) => t.signalTag !== 'NORMAL').length,
        totalVolume24hUsd: Math.round(combined.reduce((acc, t) => acc + t.amount24hUsd, 0)),
        scanLatencyMs: Math.max(12, Date.now() - startMs),
        scannedAt: Date.now(),
        tickers: combined,
      };

      cachedPionexPayload = payload;
      cachedPionexAt = Date.now();
      return payload;
    } catch (err) {
      if (cachedPionexPayload) {
        return { ...cachedPionexPayload, sourceMode: 'PIONEX_CACHED' };
      }
      throw err;
    } finally {
      inflightPionexScan = null;
    }
  })();

  return inflightPionexScan;
}

export function getCachedPionexTickerPrice(rawSymbol: string): number | undefined {
  if (!cachedPionexPayload) return undefined;
  const cleaned = rawSymbol.trim().toUpperCase();
  const match = cachedPionexPayload.tickers.find(
    (t) => t.symbol === cleaned || t.canonicalSymbol === cleaned
  );
  return match?.price;
}

const PIONEX_KLINE_INTERVAL_MAP: Record<TimeframeId, string> = {
  '1m': '1M',
  '5m': '5M',
  '15m': '15M',
  '1h': '60M',
  '4h': '4H',
  '1d': '1D',
};

export async function fetchPionexKlines(
  rawSymbol: string,
  timeframe: TimeframeId,
  limit = 300
): Promise<{
  pionexSymbol: string;
  canonicalSymbol: string;
  endpoint: string;
  candles: OHLCVCandle[];
} | null> {
  const mapped = toPionexApiSymbol(rawSymbol);
  if (!mapped) return null;

  const interval = PIONEX_KLINE_INTERVAL_MAP[timeframe] || '15M';
  const clampedLimit = Math.max(30, Math.min(500, limit));
  const candidates =
    mapped.marketType === 'PERP'
      ? [mapped.pionexSymbol, mapped.pionexSymbol.replace('_PERP', '')]
      : [mapped.pionexSymbol, `${mapped.pionexSymbol}_PERP`];

  for (const sym of candidates) {
    const url = `https://api.pionex.com/api/v1/market/klines?symbol=${encodeURIComponent(
      sym
    )}&interval=${interval}&limit=${clampedLimit}`;
    try {
      const json = await fetchAllowlistedJson<any>(url);
      const rawKlines = Array.isArray(json?.data?.klines) ? json.data.klines : [];
      if (rawKlines.length < 20) continue;

      const parsed: OHLCVCandle[] = rawKlines
        .map((k: any) => ({
          time: Number(k.time),
          open: parseFloat(k.open),
          high: parseFloat(k.high),
          low: parseFloat(k.low),
          close: parseFloat(k.close),
          volume: Math.max(0, parseFloat(k.volume || '0')),
        }))
        .filter(
          (c: OHLCVCandle) =>
            Number.isFinite(c.time) &&
            c.open > 0 &&
            c.high > 0 &&
            c.low > 0 &&
            c.close > 0 &&
            c.high >= c.low
        )
        .sort((a: OHLCVCandle, b: OHLCVCandle) => a.time - b.time);

      if (parsed.length >= 20) {
        const isPerp = sym.endsWith('_USDT_PERP');
        const { canonicalSymbol } = canonicalizePionexSymbol(
          sym,
          isPerp ? 'PERP' : 'SPOT'
        );
        return {
          pionexSymbol: sym,
          canonicalSymbol,
          endpoint: url,
          candles: parsed.slice(-clampedLimit),
        };
      }
    } catch {
      // try next candidate
    }
  }

  return null;
}

// ============================================================================
// 2. YAHOO FINANCE & MSN FINANCE LIVE NEWS AGGREGATOR
// ============================================================================

function parseRssXmlItems(
  xml: string,
  provider: FinanceNewsProvider,
  defaultSourceLabel: string
): FinanceNewsItem[] {
  const items: FinanceNewsItem[] = [];
  const itemMatches = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];

  for (const block of itemMatches.slice(0, 18)) {
    const titleRaw = block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
    const descRaw = block.match(/<description\b[^>]*>([\s\S]*?)<\/description>/i)?.[1] || '';
    const linkRaw = block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i)?.[1] || '';
    const pubDateRaw = block.match(/<pubDate\b[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1] || '';
    const newsSrcRaw =
      block.match(/<News:Source\b[^>]*>([\s\S]*?)<\/News:Source>/i)?.[1] || '';

    const title = sanitizeFeedText(titleRaw, 180);
    if (!title || title.length < 12) continue;

    const summary =
      sanitizeFeedText(descRaw, 220) ||
      `${defaultSourceLabel} live market coverage: ${title}`;
    const sourceLabel = sanitizeFeedText(newsSrcRaw, 48) || defaultSourceLabel;
    const parsedTime = pubDateRaw ? Date.parse(decodeXmlEntities(pubDateRaw).trim()) : NaN;
    const publishedAt = Number.isFinite(parsedTime) ? parsedTime : Date.now();
    const combinedText = `${title} ${summary}`;

    items.push({
      id: `${provider === 'YAHOO_FINANCE' ? 'YH' : 'MSN'}-${stableHash(
        `${provider}:${title.toLowerCase()}`
      )}`,
      provider,
      sourceLabel,
      title,
      summary,
      symbol: inferNewsSymbol(combinedText),
      publishedAt,
      timeFormatted: formatHms(publishedAt),
      sentiment: inferNewsSentiment(combinedText),
      link: sanitizeExternalArticleLink(linkRaw, provider),
    });
  }

  return items;
}

export async function fetchFinanceNewsFeed(force = false): Promise<FinanceNewsPayload> {
  const now = Date.now();
  if (!force && cachedNewsPayload && now - cachedNewsAt < NEWS_CACHE_TTL_MS) {
    return cachedNewsPayload;
  }

  if (inflightNewsFetch) {
    return inflightNewsFetch;
  }

  inflightNewsFetch = (async () => {
    const feedSpecs: Array<{
      url: string;
      provider: FinanceNewsProvider;
      label: string;
    }> = [
      {
        url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=BTC-USD,ETH-USD,SOL-USD,XRP-USD,COIN&region=US&lang=en-US',
        provider: 'YAHOO_FINANCE',
        label: 'Yahoo Finance Crypto',
      },
      {
        url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=NVDA,AAPL,TSLA,SPY,QQQ&region=US&lang=en-US',
        provider: 'YAHOO_FINANCE',
        label: 'Yahoo Finance Markets',
      },
      {
        url: 'https://www.bing.com/news/search?q=site:msn.com+finance+crypto+markets+bitcoin&format=rss',
        provider: 'MSN_FINANCE',
        label: 'MSN Finance Crypto',
      },
      {
        url: 'https://www.bing.com/news/search?q=site:msn.com+wall+street+stocks+fed+markets&format=rss',
        provider: 'MSN_FINANCE',
        label: 'MSN Money',
      },
    ];

    const settled = await Promise.all(
      feedSpecs.map(async (spec) => {
        try {
          const xml = await fetchAllowlistedText(spec.url);
          return parseRssXmlItems(xml, spec.provider, spec.label);
        } catch {
          return [] as FinanceNewsItem[];
        }
      })
    );

    const dedupMap = new Map<string, FinanceNewsItem>();
    for (const list of settled) {
      for (const item of list) {
        if (!dedupMap.has(item.id)) {
          dedupMap.set(item.id, item);
        }
      }
    }

    const allDeduped = Array.from(dedupMap.values()).sort(
      (a, b) => b.publishedAt - a.publishedAt
    );
    const yahooItems = allDeduped.filter((i) => i.provider === 'YAHOO_FINANCE').slice(0, 20);
    const msnItems = allDeduped.filter((i) => i.provider === 'MSN_FINANCE').slice(0, 20);
    const items = [...yahooItems, ...msnItems].sort((a, b) => b.publishedAt - a.publishedAt);

    if (items.length === 0 && cachedNewsPayload) {
      return cachedNewsPayload;
    }

    const payload: FinanceNewsPayload = {
      yahooCount: yahooItems.length,
      msnCount: msnItems.length,
      fetchedAt: Date.now(),
      items,
    };

    cachedNewsPayload = payload;
    cachedNewsAt = Date.now();
    return payload;
  })().finally(() => {
    inflightNewsFetch = null;
  });

  return inflightNewsFetch;
}

// ============================================================================
// 3. CHRONICLE EVENT EMITTER FOR SCREENER ENGINE (YAHOO, MSN & PIONEX ANOMALIES)
// ============================================================================

const emittedExternalChronicleIds = new Set<string>();
let lastExternalSyncAt = 0;

export function triggerAsyncExternalFeedWarmup(): void {
  const now = Date.now();
  if (now - lastExternalSyncAt < 30_000) return;
  lastExternalSyncAt = now;
  void scanPionexUniverse(false).catch(() => {});
  void fetchFinanceNewsFeed(false).catch(() => {});
}

export function drainNewExternalChronicleEvents(): ChronicleAnomalyEvent[] {
  const events: ChronicleAnomalyEvent[] = [];

  // 1. Fresh Yahoo Finance & MSN Finance headlines (balanced up to 2 Yahoo + 2 MSN per cycle)
  if (cachedNewsPayload?.items?.length) {
    let addedYahoo = 0;
    let addedMsn = 0;
    for (const item of cachedNewsPayload.items) {
      if (item.provider === 'YAHOO_FINANCE' && addedYahoo >= 2) continue;
      if (item.provider === 'MSN_FINANCE' && addedMsn >= 2) continue;
      if (addedYahoo >= 2 && addedMsn >= 2) break;

      const chrId = `CHR-${item.id}`;
      if (emittedExternalChronicleIds.has(chrId)) continue;
      emittedExternalChronicleIds.add(chrId);
      if (item.provider === 'YAHOO_FINANCE') addedYahoo++;
      else addedMsn++;

      events.push({
        id: chrId,
        timestamp: item.publishedAt,
        timeFormatted: item.timeFormatted,
        symbol: item.symbol,
        provider: item.provider,
        eventType: item.provider === 'YAHOO_FINANCE' ? 'YAHOO_NEWS' : 'MSN_NEWS',
        headline: item.title,
        detail: `${item.sourceLabel} · ${item.summary.slice(0, 120)}`,
        price: 0,
        rvol: 1.5,
        changePct: 0,
        severity: item.sentiment,
      });
    }
  }

  // 2. Top Pionex USDT Anomalies (emit top unseen anomaly per cycle so Chronicle stays informative)
  if (cachedPionexPayload?.tickers?.length) {
    const topAnomalies = cachedPionexPayload.tickers
      .filter((t) => t.signalTag !== 'NORMAL' && t.amount24hUsd >= 500_000)
      .sort((a, b) => b.rvolScore - a.rvolScore)
      .slice(0, 6);

    for (const t of topAnomalies.slice(0, 2)) {
      const bucket = Math.floor(Date.now() / 120_000);
      const chrId = `CHR-PNX-${t.symbol}-${t.signalTag}-${bucket}`;
      if (emittedExternalChronicleIds.has(chrId)) continue;
      emittedExternalChronicleIds.add(chrId);

      events.push({
        id: chrId,
        timestamp: Date.now(),
        timeFormatted: formatHms(Date.now()),
        symbol: t.canonicalSymbol,
        provider: 'PIONEX',
        eventType: 'PIONEX_SCAN',
        headline: `Pionex ${t.marketType}: ${t.canonicalSymbol} ${t.signalTag} (${t.change24hPct >= 0 ? '+' : ''}${t.change24hPct.toFixed(2)}%)`,
        detail: `24h Vol $${Math.round(t.amount24hUsd / 1e6)}M · RVOL ${t.rvolScore.toFixed(2)}x · Range ${t.rangePct.toFixed(1)}%`,
        price: t.price,
        rvol: t.rvolScore,
        changePct: t.change24hPct,
        severity:
          t.change24hPct > 0.5 ? 'BULLISH' : t.change24hPct < -0.5 ? 'BEARISH' : 'NEUTRAL',
      });
      break;
    }
  }

  // Bound seen IDs set to prevent unbounded growth in 24/7 operation
  if (emittedExternalChronicleIds.size > 400) {
    const iterator = emittedExternalChronicleIds.values();
    for (let i = 0; i < 120; i++) {
      const oldest = iterator.next().value;
      if (oldest) emittedExternalChronicleIds.delete(oldest);
    }
  }

  return events;
}

export function prunePionexAndNewsCaches(aggressive = false): number {
  let pruned = 0;
  const maxIds = aggressive ? 150 : 400;
  while (emittedExternalChronicleIds.size > maxIds) {
    const oldest = emittedExternalChronicleIds.values().next().value;
    if (!oldest) break;
    emittedExternalChronicleIds.delete(oldest);
    pruned++;
  }
  const now = Date.now();
  if (aggressive || (cachedPionexPayload && now - cachedPionexAt > PIONEX_CACHE_TTL_MS * 6)) {
    if (cachedPionexPayload && aggressive) {
      cachedPionexPayload = null;
      cachedPionexAt = 0;
      pruned++;
    }
  }
  if (aggressive && cachedNewsPayload) {
    cachedNewsPayload = null;
    cachedNewsAt = 0;
    pruned++;
  }
  return pruned;
}

export function getPionexMemoryStats() {
  return {
    externalChronicleIdsCount: emittedExternalChronicleIds.size,
    pionexTickersCached: cachedPionexPayload?.tickers?.length ?? 0,
    newsItemsCached: cachedNewsPayload?.items?.length ?? 0,
  };
}

