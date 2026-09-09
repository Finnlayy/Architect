import { WorkerBotData, OrderbookData } from '../types/trading';

export const INITIAL_WORKER_BOTS: WorkerBotData[] = [
  {
    id: 'BOT-7742',
    name: 'DCA Bot Alpha',
    exchange: 'Pionex Futures',
    status: 'active',
    pair: 'HYPE/USDT.P',
    strategy: 'PERPETUAL FUTURES · DCA STRATEGY',
    direction: 'LONG',
    leverage: 75,
    unrealizedPnL: {
      value: 12.84,
      percentage: 25.38,
    },
    entryPrice: 41.250,
    currentPrice: 43.120,
    metrics: {
      investment: 50.58,
      currency: '$',
      investmentEur: 45.00,
      realizedProfit: 8.42,
      profitCycleType: 'Realisiert (Zyklus)',
      dcaRangeMin: 39,
      dcaRangeMax: 44,
      dcaSteps: 160,
      dcaOrdersTriggered: 247,
      fundingFees: -1.14,
      liquidationPrice: 41.15,
      liquidationDistancePct: -0.83,
    },
    runtime: {
      days: 3,
      hours: 14,
      minutes: 22,
      cycles: 62,
      cycleProgressPct: 62,
    },
    totalProfit: 21.26,
    roi: 42.05,
    apr: 4480,
    lastUpdate: '14:37:02',
    statusText: 'Bot aktiv · Verbunden',
    // Convenience aliases
    symbol: 'HYPE/USDT.P',
    instrumentType: 'PERPETUAL FUTURES · DCA STRATEGY',
    investmentUsd: 50.58,
    investmentEur: 45.00,
    unrealizedPnlUsd: 12.84,
    unrealizedPnlPct: 25.38,
    currentProfitUsd: 8.42,
    totalProfitUsd: 21.26,
    roiPct: 42.05,
    aprPct: 4480,
    dcaOrdersTriggered: 247,
    lastUpdated: '14:37:02',
  },
  {
    id: 'BOT-9104',
    name: 'Alpha-Momentum Worker',
    exchange: 'Hyperliquid L2',
    status: 'active',
    pair: 'BTC/USDT.P',
    strategy: 'PERPETUAL FUTURES · MOMENTUM DCA',
    direction: 'LONG',
    leverage: 25,
    unrealizedPnL: {
      value: 184.20,
      percentage: 18.45,
    },
    entryPrice: 63200.0,
    currentPrice: 64250.0,
    metrics: {
      investment: 1000.0,
      currency: '$',
      investmentEur: 915.0,
      realizedProfit: 74.50,
      profitCycleType: 'Realisiert (Zyklus)',
      dcaRangeMin: 62000,
      dcaRangeMax: 66000,
      dcaSteps: 120,
      dcaOrdersTriggered: 89,
      fundingFees: -6.32,
      liquidationPrice: 61500.0,
      liquidationDistancePct: -4.28,
    },
    runtime: {
      days: 7,
      hours: 6,
      minutes: 41,
      cycles: 45,
      cycleProgressPct: 78,
    },
    totalProfit: 312.40,
    roi: 31.24,
    apr: 1628,
    lastUpdate: '14:37:02',
    statusText: 'Bot aktiv · Verbunden',
    linkedStrategyId: 'strat_alpha_momentum',
    symbol: 'BTC/USDT.P',
    instrumentType: 'PERPETUAL FUTURES · MOMENTUM DCA',
    investmentUsd: 1000.0,
    investmentEur: 915.0,
    unrealizedPnlUsd: 184.20,
    unrealizedPnlPct: 18.45,
    currentProfitUsd: 74.50,
    totalProfitUsd: 312.40,
    roiPct: 31.24,
    aprPct: 1628,
    dcaOrdersTriggered: 89,
    lastUpdated: '14:37:02',
  },
  {
    id: 'BOT-3382',
    name: 'Sigma Mean-Reversion Bot',
    exchange: 'dYdX v4',
    status: 'active',
    pair: 'ETH/USDT.P',
    strategy: 'PERPETUAL FUTURES · GRID-DCA',
    direction: 'LONG',
    leverage: 50,
    unrealizedPnL: {
      value: 46.10,
      percentage: 15.30,
    },
    entryPrice: 3420.0,
    currentPrice: 3480.0,
    metrics: {
      investment: 300.0,
      currency: '$',
      investmentEur: 274.5,
      realizedProfit: 28.90,
      profitCycleType: 'Realisiert (Zyklus)',
      dcaRangeMin: 3300,
      dcaRangeMax: 3600,
      dcaSteps: 80,
      dcaOrdersTriggered: 112,
      fundingFees: -2.40,
      liquidationPrice: 3350.0,
      liquidationDistancePct: -3.73,
    },
    runtime: {
      days: 5,
      hours: 18,
      minutes: 9,
      cycles: 38,
      cycleProgressPct: 54,
    },
    totalProfit: 92.40,
    roi: 30.80,
    apr: 2250,
    lastUpdate: '14:37:02',
    statusText: 'Bot aktiv · Verbunden',
    linkedStrategyId: 'strat_sigma_mean_reversion',
    symbol: 'ETH/USDT.P',
    instrumentType: 'PERPETUAL FUTURES · GRID-DCA',
    investmentUsd: 300.0,
    investmentEur: 274.5,
    unrealizedPnlUsd: 46.10,
    unrealizedPnlPct: 15.30,
    currentProfitUsd: 28.90,
    totalProfitUsd: 92.40,
    roiPct: 30.80,
    aprPct: 2250,
    dcaOrdersTriggered: 112,
    lastUpdated: '14:37:02',
  },
  {
    id: 'BOT-5519',
    name: 'Deep-RL Arbitrage Bot',
    exchange: 'Binance Futures',
    status: 'active',
    pair: 'SOL/USDT.P',
    strategy: 'PERPETUAL FUTURES · ADAPTIVE DCA',
    direction: 'LONG',
    leverage: 20,
    unrealizedPnL: {
      value: 38.40,
      percentage: 19.20,
    },
    entryPrice: 142.0,
    currentPrice: 148.5,
    metrics: {
      investment: 200.0,
      currency: '$',
      investmentEur: 183.0,
      realizedProfit: 19.80,
      profitCycleType: 'Realisiert (Zyklus)',
      dcaRangeMin: 135,
      dcaRangeMax: 155,
      dcaSteps: 100,
      dcaOrdersTriggered: 64,
      fundingFees: -1.85,
      liquidationPrice: 138.0,
      liquidationDistancePct: -7.07,
    },
    runtime: {
      days: 2,
      hours: 21,
      minutes: 15,
      cycles: 19,
      cycleProgressPct: 82,
    },
    totalProfit: 58.20,
    roi: 29.10,
    apr: 4910,
    lastUpdate: '14:37:02',
    statusText: 'Bot aktiv · Verbunden',
    linkedStrategyId: 'strat_deep_rl',
    symbol: 'SOL/USDT.P',
    instrumentType: 'PERPETUAL FUTURES · ADAPTIVE DCA',
    investmentUsd: 200.0,
    investmentEur: 183.0,
    unrealizedPnlUsd: 38.40,
    unrealizedPnlPct: 19.20,
    currentProfitUsd: 19.80,
    totalProfitUsd: 58.20,
    roiPct: 29.10,
    aprPct: 4910,
    dcaOrdersTriggered: 64,
    lastUpdated: '14:37:02',
  },
  {
    id: 'BOT-1083',
    name: 'Microstructure Scalp Bot',
    exchange: 'Bybit Linear',
    status: 'active',
    pair: 'NIO/USDT.P',
    strategy: 'PERPETUAL FUTURES · L2 ORDERBOOK DCA',
    direction: 'LONG',
    leverage: 10,
    unrealizedPnL: {
      value: 9.20,
      percentage: 12.50,
    },
    entryPrice: 5.650,
    currentPrice: 5.820,
    metrics: {
      investment: 80.0,
      currency: '$',
      investmentEur: 73.2,
      realizedProfit: 6.15,
      profitCycleType: 'Realisiert (Zyklus)',
      dcaRangeMin: 5.20,
      dcaRangeMax: 6.20,
      dcaSteps: 50,
      dcaOrdersTriggered: 38,
      fundingFees: -0.45,
      liquidationPrice: 5.25,
      liquidationDistancePct: -9.79,
    },
    runtime: {
      days: 1,
      hours: 11,
      minutes: 4,
      cycles: 12,
      cycleProgressPct: 40,
    },
    totalProfit: 15.80,
    roi: 19.75,
    apr: 650,
    lastUpdate: '14:37:02',
    statusText: 'Bot aktiv · Verbunden',
    linkedStrategyId: 'strat_orderbook_microstructure',
    symbol: 'NIO/USDT.P',
    instrumentType: 'PERPETUAL FUTURES · L2 ORDERBOOK DCA',
    investmentUsd: 80.0,
    investmentEur: 73.2,
    unrealizedPnlUsd: 9.20,
    unrealizedPnlPct: 12.50,
    currentProfitUsd: 6.15,
    totalProfitUsd: 15.80,
    roiPct: 19.75,
    aprPct: 650,
    dcaOrdersTriggered: 38,
    lastUpdated: '14:37:02',
  },
  {
    id: 'BOT-6621',
    name: 'Gamma Hedging Worker',
    exchange: 'Deribit Direct',
    status: 'active',
    pair: 'ETH/USDT.P',
    strategy: 'PERPETUAL FUTURES · SHORT DELTA HEDGE',
    direction: 'SHORT',
    leverage: 20,
    unrealizedPnL: {
      value: 24.50,
      percentage: 16.33,
    },
    entryPrice: 3510.0,
    currentPrice: 3480.0,
    metrics: {
      investment: 150.0,
      currency: '$',
      investmentEur: 137.25,
      realizedProfit: 14.20,
      profitCycleType: 'Realisiert (Zyklus)',
      dcaRangeMin: 3400,
      dcaRangeMax: 3600,
      dcaSteps: 60,
      dcaOrdersTriggered: 42,
      fundingFees: 1.85,
      liquidationPrice: 3685.0,
      liquidationDistancePct: 5.89,
    },
    runtime: {
      days: 4,
      hours: 9,
      minutes: 33,
      cycles: 28,
      cycleProgressPct: 68,
    },
    totalProfit: 38.70,
    roi: 25.80,
    apr: 1940,
    lastUpdate: '14:37:02',
    statusText: 'Bot aktiv · Verbunden',
    symbol: 'ETH/USDT.P',
    instrumentType: 'PERPETUAL FUTURES · SHORT DELTA HEDGE',
    investmentUsd: 150.0,
    investmentEur: 137.25,
    unrealizedPnlUsd: 24.50,
    unrealizedPnlPct: 16.33,
    currentProfitUsd: 14.20,
    totalProfitUsd: 38.70,
    roiPct: 25.80,
    aprPct: 1940,
    dcaOrdersTriggered: 42,
    lastUpdated: '14:37:02',
  },
];

/**
 * Revaluates established worker bots against real-time orderbook ticks
 */
export function updateWorkerBotsWithMarket(
  bots: WorkerBotData[],
  markets: Record<string, OrderbookData>
): WorkerBotData[] {
  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0];

  return bots.map((bot) => {
    const pair = bot.pair || bot.symbol || 'BTC/USDT.P';

    // Lookup matching book: e.g. HYPE/USDT.P -> HYPE/USD
    let bookSymbol = 'HYPE/USD';
    if (pair.startsWith('BTC')) bookSymbol = 'BTC/USD';
    else if (pair.startsWith('ETH')) bookSymbol = 'ETH/USD';
    else if (pair.startsWith('SOL')) bookSymbol = 'SOL/USD';
    else if (pair.startsWith('NIO')) bookSymbol = 'NIO/USD';

    const book = markets[bookSymbol];
    if (!book) return bot;

    const currentPrice = book.lastPrice;
    const priceDiff = currentPrice - bot.entryPrice;
    const directionMultiplier = bot.direction === 'LONG' ? 1 : -1;

    // Position nominal value
    const investment = bot.metrics?.investment ?? bot.investmentUsd ?? 100;
    const positionNominal = investment * bot.leverage;
    const pnlRatio = (priceDiff / bot.entryPrice) * directionMultiplier;
    const unrealizedValue = Math.round(positionNominal * pnlRatio * 100) / 100;
    const unrealizedPct = Math.round(pnlRatio * bot.leverage * 10000) / 100;

    const realizedProfit = bot.metrics?.realizedProfit ?? bot.currentProfitUsd ?? 0;
    const totalProfit = Math.round((realizedProfit + unrealizedValue) * 100) / 100;
    const roi = Math.round((totalProfit / investment) * 10000) / 100;

    // Liquidation distance
    const liqPrice = bot.metrics?.liquidationPrice ?? currentPrice * 0.95;
    const liqDist = Math.round(((liqPrice - currentPrice) / currentPrice) * 10000) / 100;

    const updatedMetrics = {
      ...bot.metrics,
      liquidationDistancePct: liqDist,
    };

    const updatedUnrealized = {
      value: unrealizedValue,
      percentage: unrealizedPct,
    };

    return {
      ...bot,
      currentPrice,
      unrealizedPnL: updatedUnrealized,
      metrics: updatedMetrics,
      totalProfit,
      roi,
      lastUpdate: timeStr,
      // Sync convenience aliases
      unrealizedPnlUsd: unrealizedValue,
      unrealizedPnlPct: unrealizedPct,
      totalProfitUsd: totalProfit,
      roiPct: roi,
      lastUpdated: timeStr,
    };
  });
}
