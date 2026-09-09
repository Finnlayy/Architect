import express, { Request, Response } from 'express';
import path from 'path';
import https from 'https';
import WebSocket, { WebSocketServer } from 'ws';
import { createServer as createViteServer } from 'vite';

const app = express();
const PORT = 3000;

app.use(express.json());

// In-Memory Kraken Orderbook Data Structure
interface OrderbookLevel {
  price: number;
  size: number;
  total: number;
}

interface TradeTape {
  id: string;
  price: number;
  size: number;
  side: 'BUY' | 'SELL';
  timestamp: number;
}

interface MarketState {
  symbol: string;
  lastPrice: number;
  priceChange24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  spread: number;
  spreadBps: number;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  recentTrades: TradeTape[];
  lastUpdated: number;
}

// Global cached markets state populated from live Kraken feed
const marketsState: Record<string, MarketState> = {
  'BTC/USD': {
    symbol: 'BTC/USD',
    lastPrice: 79600.0,
    priceChange24h: 1.25,
    high24h: 80500.0,
    low24h: 78900.0,
    volume24h: 95000000,
    spread: 0.5,
    spreadBps: 0.6,
    bids: [],
    asks: [],
    recentTrades: [],
    lastUpdated: Date.now(),
  },
  'ETH/USD': {
    symbol: 'ETH/USD',
    lastPrice: 2518.0,
    priceChange24h: -0.45,
    high24h: 2550.0,
    low24h: 2480.0,
    volume24h: 42000000,
    spread: 0.1,
    spreadBps: 0.4,
    bids: [],
    asks: [],
    recentTrades: [],
    lastUpdated: Date.now(),
  },
  'SOL/USD': {
    symbol: 'SOL/USD',
    lastPrice: 148.5,
    priceChange24h: 3.1,
    high24h: 152.0,
    low24h: 144.0,
    volume24h: 18000000,
    spread: 0.02,
    spreadBps: 1.3,
    bids: [],
    asks: [],
    recentTrades: [],
    lastUpdated: Date.now(),
  },
  'NIO/USD': {
    symbol: 'NIO/USD',
    lastPrice: 5.82,
    priceChange24h: 0.85,
    high24h: 5.95,
    low24h: 5.72,
    volume24h: 12500000,
    spread: 0.01,
    spreadBps: 17.2,
    bids: [
      { price: 5.81, size: 2400, total: 2400 },
      { price: 5.80, size: 3100, total: 5500 },
      { price: 5.79, size: 1850, total: 7350 },
    ],
    asks: [
      { price: 5.82, size: 1950, total: 1950 },
      { price: 5.83, size: 2800, total: 4750 },
      { price: 5.84, size: 3400, total: 8150 },
    ],
    recentTrades: [
      { id: 'NIO-1', price: 5.82, size: 500, side: 'BUY', timestamp: Date.now() - 400 },
    ],
    lastUpdated: Date.now(),
  },
  'HYPE/USD': {
    symbol: 'HYPE/USD',
    lastPrice: 43.12,
    priceChange24h: 2.4,
    high24h: 44.5,
    low24h: 41.8,
    volume24h: 34000000,
    spread: 0.01,
    spreadBps: 2.3,
    bids: [
      { price: 43.11, size: 85, total: 85 },
      { price: 43.10, size: 120, total: 205 },
      { price: 43.08, size: 95, total: 300 },
    ],
    asks: [
      { price: 43.12, size: 90, total: 90 },
      { price: 43.14, size: 140, total: 230 },
      { price: 43.15, size: 110, total: 340 },
    ],
    recentTrades: [
      { id: 'HYPE-1', price: 43.12, size: 25, side: 'BUY', timestamp: Date.now() - 300 },
    ],
    lastUpdated: Date.now(),
  },
};

// Kraken Stream Metrics & Health
let krakenWsStatus: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR' = 'CONNECTING';
let krakenMessagesReceived = 0;
let krakenLastMessageAt: number = Date.now();
let krakenReconnectAttempts = 0;

// Connected SSE clients & Port 1000 WebSocket clients
const sseClients: Set<Response> = new Set();
const wsPort1000Clients: Set<WebSocket> = new Set();
let broadcastTimeout: NodeJS.Timeout | null = null;
const dirtySymbols: Set<string> = new Set();

function broadcastMarketUpdate(symbol: string) {
  dirtySymbols.add(symbol);
  if (!broadcastTimeout) {
    broadcastTimeout = setTimeout(() => {
      broadcastTimeout = null;
      if (sseClients.size === 0 && wsPort1000Clients.size === 0) {
        dirtySymbols.clear();
        return;
      }
      for (const sym of dirtySymbols) {
        if (!marketsState[sym]) continue;
        const payload = JSON.stringify({
          type: 'MARKET_TICK',
          symbol: sym,
          data: marketsState[sym],
          timestamp: Date.now(),
        });
        // 1. Broadcast to SSE clients
        for (const client of sseClients) {
          try {
            client.write(`event: market_update\ndata: ${payload}\n\n`);
          } catch (e) {
            sseClients.delete(client);
          }
        }
        // 2. Broadcast to Port 1000 WebSocket clients
        for (const client of wsPort1000Clients) {
          try {
            if (client.readyState === WebSocket.OPEN) {
              client.send(payload);
            } else {
              wsPort1000Clients.delete(client);
            }
          } catch (e) {
            wsPort1000Clients.delete(client);
          }
        }
      }
      dirtySymbols.clear();
    }, 200);
  }
}

// REST fallback bootstrap from Kraken Public API
function bootstrapKrakenDepthRest() {
  const pairs = [
    { krakenPair: 'XBTUSD', canonical: 'BTC/USD' },
    { krakenPair: 'ETHUSD', canonical: 'ETH/USD' },
    { krakenPair: 'SOLUSD', canonical: 'SOL/USD' },
  ];

  for (const { krakenPair, canonical } of pairs) {
    const url = `https://api.kraken.com/0/public/Depth?pair=${krakenPair}&count=10`;
    https
      .get(url, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            if (!parsed.error?.length && parsed.result) {
              const resKey = Object.keys(parsed.result)[0];
              const depth = parsed.result[resKey];
              if (depth && depth.bids && depth.asks) {
                applyRestDepth(canonical, depth.bids, depth.asks);
              }
            }
          } catch (err) {
            // Ignored, WS will populate
          }
        });
      })
      .on('error', () => {
        // Network offline fallback
      });
  }
}

function applyRestDepth(symbol: string, rawBids: [string, string, number][], rawAsks: [string, string, number][]) {
  const m = marketsState[symbol];
  if (!m) return;

  let bidTotal = 0;
  m.bids = rawBids.slice(0, 10).map(([p, s]) => {
    const price = parseFloat(p);
    const size = parseFloat(s);
    bidTotal += size;
    return { price, size: Math.round(size * 1000) / 1000, total: Math.round(bidTotal * 1000) / 1000 };
  });

  let askTotal = 0;
  m.asks = rawAsks.slice(0, 10).map(([p, s]) => {
    const price = parseFloat(p);
    const size = parseFloat(s);
    askTotal += size;
    return { price, size: Math.round(size * 1000) / 1000, total: Math.round(askTotal * 1000) / 1000 };
  });

  if (m.bids.length > 0 && m.asks.length > 0) {
    const bestBid = m.bids[0].price;
    const bestAsk = m.asks[0].price;
    m.lastPrice = Math.round(((bestBid + bestAsk) / 2) * 100) / 100;
    m.spread = Math.round((bestAsk - bestBid) * 100) / 100;
    m.spreadBps = Math.round(((m.spread / m.lastPrice) * 10000) * 10) / 10;
  }
  m.lastUpdated = Date.now();
  broadcastMarketUpdate(symbol);
}

// Background Kraken WebSocket v2 Connection
let krakenWs: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;

function connectKrakenWebSocket() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  krakenWsStatus = 'CONNECTING';
  try {
    krakenWs = new WebSocket('wss://ws.kraken.com/v2');

    krakenWs.on('open', () => {
      krakenWsStatus = 'CONNECTED';
      krakenReconnectAttempts = 0;
      console.log('[Kraken Stream] Successfully connected to wss://ws.kraken.com/v2');

      // Subscribe to Orderbook Level 2 Depth (10 levels) for BTC/USD, ETH/USD, SOL/USD
      krakenWs?.send(
        JSON.stringify({
          method: 'subscribe',
          params: {
            channel: 'book',
            symbol: ['BTC/USD', 'ETH/USD', 'SOL/USD'],
            depth: 10,
          },
        })
      );

      // Subscribe to real-time Trade executions tape
      krakenWs?.send(
        JSON.stringify({
          method: 'subscribe',
          params: {
            channel: 'trade',
            symbol: ['BTC/USD', 'ETH/USD', 'SOL/USD'],
          },
        })
      );
    });

    krakenWs.on('message', (raw: WebSocket.Data) => {
      try {
        const msg = JSON.parse(raw.toString());
        krakenMessagesReceived++;
        krakenLastMessageAt = Date.now();

        // Handle L2 Book Snapshot and Incremental Updates
        if (msg.channel === 'book' && Array.isArray(msg.data)) {
          for (const item of msg.data) {
            const sym = item.symbol;
            if (!marketsState[sym]) continue;

            const market = marketsState[sym];

            if (msg.type === 'snapshot') {
              // Full snapshot replacement
              if (Array.isArray(item.bids)) {
                let accum = 0;
                market.bids = item.bids.slice(0, 10).map((b: { price: number; qty: number }) => {
                  accum += b.qty;
                  return {
                    price: b.price,
                    size: Math.round(b.qty * 1000) / 1000,
                    total: Math.round(accum * 1000) / 1000,
                  };
                });
              }
              if (Array.isArray(item.asks)) {
                let accum = 0;
                market.asks = item.asks.slice(0, 10).map((a: { price: number; qty: number }) => {
                  accum += a.qty;
                  return {
                    price: a.price,
                    size: Math.round(a.qty * 1000) / 1000,
                    total: Math.round(accum * 1000) / 1000,
                  };
                });
              }
            } else if (msg.type === 'update') {
              // Merge top bids
              if (Array.isArray(item.bids)) {
                for (const b of item.bids) {
                  const existingIdx = market.bids.findIndex((x) => x.price === b.price);
                  if (b.qty === 0) {
                    if (existingIdx !== -1) market.bids.splice(existingIdx, 1);
                  } else {
                    if (existingIdx !== -1) {
                      market.bids[existingIdx].size = b.qty;
                    } else {
                      market.bids.push({ price: b.price, size: b.qty, total: b.qty });
                    }
                  }
                }
                market.bids.sort((a, b) => b.price - a.price);
                market.bids = market.bids.slice(0, 10);
                let acc = 0;
                market.bids.forEach((lvl) => {
                  acc += lvl.size;
                  lvl.total = Math.round(acc * 1000) / 1000;
                });
              }

              // Merge top asks
              if (Array.isArray(item.asks)) {
                for (const a of item.asks) {
                  const existingIdx = market.asks.findIndex((x) => x.price === a.price);
                  if (a.qty === 0) {
                    if (existingIdx !== -1) market.asks.splice(existingIdx, 1);
                  } else {
                    if (existingIdx !== -1) {
                      market.asks[existingIdx].size = a.qty;
                    } else {
                      market.asks.push({ price: a.price, size: a.qty, total: a.qty });
                    }
                  }
                }
                market.asks.sort((a, b) => a.price - b.price);
                market.asks = market.asks.slice(0, 10);
                let acc = 0;
                market.asks.forEach((lvl) => {
                  acc += lvl.size;
                  lvl.total = Math.round(acc * 1000) / 1000;
                });
              }
            }

            // Recalculate Spread & Midprice
            if (market.bids.length > 0 && market.asks.length > 0) {
              const bestBid = market.bids[0].price;
              const bestAsk = market.asks[0].price;
              market.lastPrice = Math.round(((bestBid + bestAsk) / 2) * 100) / 100;
              market.spread = Math.round((bestAsk - bestBid) * 100) / 100;
              market.spreadBps = Math.round(((market.spread / market.lastPrice) * 10000) * 10) / 10;
            }

            market.lastUpdated = Date.now();
            broadcastMarketUpdate(sym);
          }
        }

        // Handle Trade Stream
        if (msg.channel === 'trade' && Array.isArray(msg.data)) {
          for (const t of msg.data) {
            const sym = t.symbol;
            if (!marketsState[sym]) continue;
            const market = marketsState[sym];

            market.lastPrice = t.price;
            market.recentTrades.unshift({
              id: String(t.trade_id || Date.now()),
              price: t.price,
              size: Math.round(t.qty * 1000) / 1000,
              side: t.side === 'buy' ? 'BUY' : 'SELL',
              timestamp: Date.now(),
            });
            market.recentTrades = market.recentTrades.slice(0, 20);
            market.lastUpdated = Date.now();
            broadcastMarketUpdate(sym);
          }
        }
      } catch (err) {
        // Safe JSON ignore
      }
    });

    krakenWs.on('error', (err) => {
      krakenWsStatus = 'ERROR';
      console.warn('[Kraken Stream] WebSocket encountered error:', err.message);
    });

    krakenWs.on('close', () => {
      krakenWsStatus = 'DISCONNECTED';
      krakenReconnectAttempts++;
      const delay = Math.min(10000, 1000 * Math.pow(1.5, krakenReconnectAttempts));
      console.warn(`[Kraken Stream] Connection closed. Auto-reconnecting in ${Math.round(delay)}ms...`);
      reconnectTimer = setTimeout(connectKrakenWebSocket, delay);
    });
  } catch (err: any) {
    krakenWsStatus = 'ERROR';
    console.error('[Kraken Stream] Initialization error:', err.message);
    reconnectTimer = setTimeout(connectKrakenWebSocket, 4000);
  }
}

// Initial bootstrap
bootstrapKrakenDepthRest();
connectKrakenWebSocket();

// Periodic REST refresh as watchdog (every 10 seconds) to ensure fresh depth even under WS network pause
setInterval(() => {
  if (krakenWsStatus !== 'CONNECTED' || Date.now() - krakenLastMessageAt > 8000) {
    bootstrapKrakenDepthRest();
  }
}, 10000);

// --- API ROUTES FIRST ---

app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    krakenStatus: krakenWsStatus,
    messagesReceived: krakenMessagesReceived,
    clientsConnected: sseClients.size,
  });
});

// Snapshot of all markets
app.get('/api/kraken/orderbook', (req: Request, res: Response) => {
  res.json({
    source: 'KRAKEN_REAL_TIME',
    status: krakenWsStatus,
    timestamp: Date.now(),
    markets: marketsState,
  });
});

// Stream health and diagnostics
app.get('/api/kraken/status', (req: Request, res: Response) => {
  res.json({
    wsStatus: krakenWsStatus,
    endpoint: 'wss://ws.kraken.com/v2',
    restFallback: 'https://api.kraken.com/0/public/Depth',
    messagesReceived: krakenMessagesReceived,
    lastMessageAgeMs: Date.now() - krakenLastMessageAt,
    activeSubscribers: sseClients.size,
    supportedSymbols: Object.keys(marketsState),
    online: krakenWsStatus === 'CONNECTED' || Date.now() - krakenLastMessageAt < 15000,
  });
});

// Real-time Server-Sent Events (SSE) Stream
app.get('/api/kraken/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send initial full snapshot immediately
  res.write(
    `event: initial_snapshot\ndata: ${JSON.stringify({
      markets: marketsState,
      wsStatus: krakenWsStatus,
      timestamp: Date.now(),
    })}\n\n`
  );

  sseClients.add(res);

  // Keep-alive heartbeat every 15s
  const heartbeat = setInterval(() => {
    res.write(`: keepalive ${Date.now()}\n\n`);
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// Force reconnect trigger (useful for sandbox recovery or user diagnostics)
app.post('/api/kraken/reconnect', (req: Request, res: Response) => {
  if (krakenWs) {
    try {
      krakenWs.terminate();
    } catch (e) {}
  }
  bootstrapKrakenDepthRest();
  connectKrakenWebSocket();
  res.json({ success: true, message: 'Reconnecting to Kraken Stream' });
});

// Swarm Bots State & Live Broadcaster for /api/v1/swarm/stream
interface SwarmBotServerState {
  id: string;
  name: string;
  exchange: string;
  status: 'active' | 'paused';
  pair: string;
  currentPrice: number;
  unrealizedPnL: {
    value: number;
    percentage: number;
  };
  metrics: {
    investment: number;
    realizedProfit: number;
    dcaOrdersTriggered: number;
  };
}

const swarmBotsServerState: SwarmBotServerState[] = [
  {
    id: 'BOT-7742',
    name: 'DCA Bot Alpha',
    exchange: 'Pionex Futures',
    status: 'active',
    pair: 'HYPE/USDT.P',
    currentPrice: 43.12,
    unrealizedPnL: { value: 13.45, percentage: 26.12 },
    metrics: { investment: 50.58, realizedProfit: 8.42, dcaOrdersTriggered: 248 },
  },
  {
    id: 'BOT-9104',
    name: 'Alpha-Momentum Worker',
    exchange: 'Hyperliquid L2',
    status: 'active',
    pair: 'BTC/USDT.P',
    currentPrice: 79650.0,
    unrealizedPnL: { value: 184.2, percentage: 18.45 },
    metrics: { investment: 1000.0, realizedProfit: 74.5, dcaOrdersTriggered: 89 },
  },
  {
    id: 'BOT-3382',
    name: 'Sigma Mean-Reversion Bot',
    exchange: 'dYdX v4',
    status: 'active',
    pair: 'ETH/USDT.P',
    currentPrice: 2518.5,
    unrealizedPnL: { value: 46.1, percentage: 15.3 },
    metrics: { investment: 300.0, realizedProfit: 28.9, dcaOrdersTriggered: 112 },
  },
  {
    id: 'BOT-5519',
    name: 'Deep-RL Arbitrage Bot',
    exchange: 'Binance Futures',
    status: 'active',
    pair: 'SOL/USDT.P',
    currentPrice: 148.5,
    unrealizedPnL: { value: 38.4, percentage: 19.2 },
    metrics: { investment: 200.0, realizedProfit: 19.8, dcaOrdersTriggered: 64 },
  },
  {
    id: 'BOT-1083',
    name: 'Microstructure Scalp Bot',
    exchange: 'Bybit Linear',
    status: 'active',
    pair: 'NIO/USDT.P',
    currentPrice: 5.82,
    unrealizedPnL: { value: 9.2, percentage: 12.5 },
    metrics: { investment: 80.0, realizedProfit: 6.15, dcaOrdersTriggered: 38 },
  },
];

const swarmWsClients = new Set<WebSocket>();

// Historical Terminated Bots (Database simulation)
const swarmBotsHistory: any[] = [
  {
    id: 'BOT-6012',
    name: 'BTC Macro-Trend Swarm',
    exchange: 'Hyperliquid L2',
    status: 'completed',
    finishReason: 'TAKE_PROFIT',
    finishedAt: 'Vor 2 Std.',
    pair: 'BTC/USDT.P',
    strategy: 'PERPETUAL FUTURES · TREND SURF',
    direction: 'LONG',
    leverage: 50,
    unrealizedPnL: { value: 0.0, percentage: 0.0 },
    entryPrice: 76820.0,
    currentPrice: 80250.0,
    metrics: {
      investment: 1000.0,
      currency: '$',
      investmentEur: 920.0,
      realizedProfit: 412.5,
      profitCycleType: 'Take-Profit realisiert',
      dcaRangeMin: 76000,
      dcaRangeMax: 80500,
      dcaSteps: 120,
      dcaOrdersTriggered: 148,
      fundingFees: -8.45,
      liquidationPrice: 74200.0,
      liquidationDistancePct: -7.54,
    },
    runtime: {
      days: 5,
      hours: 18,
      minutes: 42,
      cycles: 100,
      cycleProgressPct: 100,
    },
    totalProfit: 412.5,
    roi: 41.25,
    apr: 2840,
    statusText: 'Beendet · Take-Profit erreicht',
    durationFormatted: '5 Tage 18 Std.',
    lastUpdated: 'Take-Profit Hit',
  },
  {
    id: 'BOT-4491',
    name: 'SOL Volatility DCA Agent',
    exchange: 'Binance Futures',
    status: 'completed',
    finishReason: 'TAKE_PROFIT',
    finishedAt: 'Vor 5 Std.',
    pair: 'SOL/USDT.P',
    strategy: 'VOLATILITY DCA · MEAN REVERSION',
    direction: 'LONG',
    leverage: 30,
    unrealizedPnL: { value: 0.0, percentage: 0.0 },
    entryPrice: 139.4,
    currentPrice: 148.8,
    metrics: {
      investment: 300.0,
      currency: '$',
      investmentEur: 275.0,
      realizedProfit: 86.4,
      profitCycleType: 'Zyklus beendet',
      dcaRangeMin: 135,
      dcaRangeMax: 152,
      dcaSteps: 80,
      dcaOrdersTriggered: 74,
      fundingFees: -2.3,
      liquidationPrice: 131.2,
      liquidationDistancePct: -11.8,
    },
    runtime: {
      days: 2,
      hours: 9,
      minutes: 15,
      cycles: 48,
      cycleProgressPct: 100,
    },
    totalProfit: 86.4,
    roi: 28.8,
    apr: 3910,
    statusText: 'Beendet · Take-Profit erreicht',
    durationFormatted: '2 Tage 9 Std.',
    lastUpdated: 'Take-Profit Hit',
  },
  {
    id: 'BOT-2184',
    name: 'ETH Funding-Arbitrage Worker',
    exchange: 'dYdX v4',
    status: 'stopped',
    finishReason: 'MANUAL_STOP',
    finishedAt: 'Gestern, 19:40',
    pair: 'ETH/USDT.P',
    strategy: 'DELTA-NEUTRAL FUNDING ARB',
    direction: 'SHORT',
    leverage: 25,
    unrealizedPnL: { value: 0.0, percentage: 0.0 },
    entryPrice: 2590.0,
    currentPrice: 2540.0,
    metrics: {
      investment: 500.0,
      currency: '$',
      investmentEur: 460.0,
      realizedProfit: 42.1,
      profitCycleType: 'Manuell gestoppt',
      dcaRangeMin: 2500,
      dcaRangeMax: 2650,
      dcaSteps: 60,
      dcaOrdersTriggered: 52,
      fundingFees: +18.4,
      liquidationPrice: 2780.0,
      liquidationDistancePct: +9.4,
    },
    runtime: {
      days: 4,
      hours: 6,
      minutes: 30,
      cycles: 32,
      cycleProgressPct: 100,
    },
    totalProfit: 42.1,
    roi: 8.42,
    apr: 760,
    statusText: 'Beendet · Manuell gestoppt',
    durationFormatted: '4 Tage 6 Std.',
    lastUpdated: 'Manuell gestoppt',
  },
];

// REST Endpoints for Swarm Bots
app.get('/api/v1/swarm/bots', (req: Request, res: Response) => {
  res.json({ bots: swarmBotsServerState, count: swarmBotsServerState.length });
});

app.get('/api/v1/swarm/history', (req: Request, res: Response) => {
  res.json(swarmBotsHistory);
});

// Lifecycle: Stop a worker bot, record to history, broadcast BOT_FINISHED
app.post('/api/v1/swarm/stop', (req: Request, res: Response) => {
  const { botId, reason = 'MANUAL_STOP' } = req.body;
  const index = swarmBotsServerState.findIndex((b) => b.id === botId);
  if (index === -1) {
    return res.status(404).json({ error: 'Bot not found in active swarm' });
  }

  // 1. Aus Live-Engine löschen
  const [removedBot] = swarmBotsServerState.splice(index, 1);

  // 2. In History speichern
  const finishedBot = {
    ...removedBot,
    status: reason === 'LIQUIDATED' ? 'liquidated' : reason === 'TAKE_PROFIT' ? 'completed' : 'stopped',
    finishReason: reason,
    finishedAt: 'Gerade eben',
    statusText: `Beendet · ${reason}`,
    durationFormatted: 'Session beendet',
  };
  swarmBotsHistory.unshift(finishedBot);

  // 3. Frontend über WebSocket informieren, dass der Bot weg ist
  const broadcastPayload = {
    type: 'BOT_FINISHED',
    payload: { id: botId, reason },
  };
  const msgStr = JSON.stringify(broadcastPayload);
  for (const client of swarmWsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msgStr);
    }
  }

  res.json({ success: true, finishedBot });
});

app.post('/api/v1/swarm/toggle', (req: Request, res: Response) => {
  const { botId } = req.body;
  const bot = swarmBotsServerState.find((b) => b.id === botId);
  if (!bot) {
    return res.status(404).json({ error: 'Bot not found' });
  }
  bot.status = bot.status === 'active' ? 'paused' : 'active';

  const payload = {
    type: 'TICK_UPDATE',
    payload: {
      id: bot.id,
      status: bot.status,
      statusText: bot.status === 'active' ? 'Bot aktiv · Verbunden' : 'Bot pausiert · Manuell',
    },
  };
  const msgStr = JSON.stringify(payload);
  for (const client of swarmWsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msgStr);
    }
  }

  res.json({ success: true, botId: bot.id, status: bot.status });
});

// --- VITE MIDDLEWARE SETUP ---
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Quant Engine] Server listening on http://0.0.0.0:${PORT}`);
  });

  // Attach Swarm WebSocket Server to /api/v1/swarm/stream
  const swarmWsServer = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    try {
      const url = new URL(request.url || '', `http://${request.headers.host}`);
      if (url.pathname === '/api/v1/swarm/stream') {
        swarmWsServer.handleUpgrade(request, socket, head, (ws) => {
          swarmWsServer.emit('connection', ws, request);
        });
      }
    } catch (e) {
      // ignore
    }
  });

  swarmWsServer.on('connection', (socket: WebSocket) => {
    console.log('[Swarm WS] Client connected to /api/v1/swarm/stream');
    swarmWsClients.add(socket);

    // Initial snapshot of each bot
    for (const b of swarmBotsServerState) {
      socket.send(
        JSON.stringify({
          type: 'TICK_UPDATE',
          payload: {
            id: b.id,
            currentPrice: b.currentPrice,
            unrealizedPnL: b.unrealizedPnL,
            metrics: b.metrics,
            status: b.status,
          },
        })
      );
    }

    socket.on('message', (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'TOGGLE_STATUS' && msg.botId) {
          const target = swarmBotsServerState.find((b) => b.id === msg.botId);
          if (target) {
            target.status = target.status === 'active' ? 'paused' : 'active';
            console.log(`[Swarm WS] Toggle status for ${target.id} -> ${target.status}`);
            const broadcastMsg = JSON.stringify({
              type: 'TICK_UPDATE',
              payload: {
                id: target.id,
                status: target.status,
                statusText: target.status === 'active' ? 'Bot aktiv · Verbunden' : 'Bot pausiert · Manuell',
              },
            });
            for (const client of swarmWsClients) {
              if (client.readyState === WebSocket.OPEN) {
                client.send(broadcastMsg);
              }
            }
          }
        } else if (msg.type === 'STOP_BOT' && msg.botId) {
          const index = swarmBotsServerState.findIndex((b) => b.id === msg.botId);
          if (index !== -1) {
            const reason = msg.reason || 'MANUAL_STOP';
            const [removedBot] = swarmBotsServerState.splice(index, 1);
            const finishedBot = {
              ...removedBot,
              status: reason === 'LIQUIDATED' ? 'liquidated' : reason === 'TAKE_PROFIT' ? 'completed' : 'stopped',
              finishReason: reason,
              finishedAt: 'Gerade eben',
              statusText: `Beendet · ${reason}`,
              durationFormatted: 'Session beendet',
            };
            swarmBotsHistory.unshift(finishedBot);
            console.log(`[Swarm WS] STOP_BOT verarbeitet für ${removedBot.id} (${reason})`);

            const broadcastMsg = JSON.stringify({
              type: 'BOT_FINISHED',
              payload: { id: msg.botId, reason },
            });
            for (const client of swarmWsClients) {
              if (client.readyState === WebSocket.OPEN) {
                client.send(broadcastMsg);
              }
            }
          }
        }
      } catch (err) {
        console.warn('[Swarm WS] Failed to parse message:', err);
      }
    });

    socket.on('close', () => {
      swarmWsClients.delete(socket);
    });

    socket.on('error', (err: Error) => {
      console.warn('[Swarm WS] Socket error:', err.message);
      swarmWsClients.delete(socket);
    });
  });

  // Periodic TICK_UPDATE broadcaster: Every 1200ms
  setInterval(() => {
    if (swarmWsClients.size === 0) return;

    for (const b of swarmBotsServerState) {
      if (b.status !== 'active') continue;

      const deltaPercent = (Math.random() - 0.49) * 0.003;
      b.currentPrice = Number((b.currentPrice * (1 + deltaPercent)).toFixed(b.currentPrice < 10 ? 4 : 2));

      b.unrealizedPnL.value = Number((b.unrealizedPnL.value + (Math.random() - 0.48) * 0.15).toFixed(2));
      b.unrealizedPnL.percentage = Number(((b.unrealizedPnL.value / b.metrics.investment) * 100).toFixed(2));

      if (Math.random() < 0.12) {
        b.metrics.dcaOrdersTriggered += 1;
        b.metrics.realizedProfit = Number((b.metrics.realizedProfit + 0.15).toFixed(2));
      }

      const tickUpdate = {
        type: 'TICK_UPDATE',
        payload: {
          id: b.id,
          currentPrice: b.currentPrice,
          unrealizedPnL: {
            value: b.unrealizedPnL.value,
            percentage: b.unrealizedPnL.percentage,
          },
          metrics: {
            investment: b.metrics.investment,
            realizedProfit: b.metrics.realizedProfit,
            dcaOrdersTriggered: b.metrics.dcaOrdersTriggered,
          },
        },
      };

      const serialized = JSON.stringify(tickUpdate);
      for (const client of swarmWsClients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(serialized);
        }
      }
    }
  }, 1200);

  // Dedicated WebSocket Server on Port 1000 for direct HFT subscribers
  try {
    const wsServer1000 = new WebSocketServer({ port: 1000, host: '0.0.0.0' }, () => {
      console.log('[Quant Engine] Direct WebSocket Server successfully active on port 1000');
    });

    wsServer1000.on('connection', (socket: WebSocket) => {
      console.log('[Port 1000 WS] Client connected to port 1000 stream');
      wsPort1000Clients.add(socket);

      // Immediately transmit current Level-2 consolidated orderbook snapshot
      socket.send(
        JSON.stringify({
          type: 'SNAPSHOT',
          source: 'KRAKEN_WS_PORT_1000',
          markets: marketsState,
          timestamp: Date.now(),
        })
      );

      socket.on('message', (msg: Buffer | string) => {
        try {
          const parsed = JSON.parse(msg.toString());
          if (parsed.type === 'SUBSCRIBE') {
            socket.send(
              JSON.stringify({
                type: 'SUBSCRIPTION_ACK',
                port: 1000,
                channels: parsed.channels || ['book'],
                status: 'ACTIVE',
              })
            );
          }
        } catch {
          // Ignore non-json
        }
      });

      socket.on('close', () => {
        wsPort1000Clients.delete(socket);
      });

      socket.on('error', (err: Error) => {
        console.warn('[Port 1000 WS] Socket error:', err.message);
        wsPort1000Clients.delete(socket);
      });
    });

    wsServer1000.on('error', (err: any) => {
      console.warn('[Port 1000 WS] WebSocket Server error (may be bound externally):', err.message);
    });
  } catch (err: any) {
    console.warn('[Port 1000 WS] Could not bind WebSocket Server to port 1000:', err.message);
  }
}

startServer();
