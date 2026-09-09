import { OrderbookData, OrderbookEntry, PortfolioState, Position, ExecutionOrder, JudgeVerdict } from '../types/trading';

export function createInitialMarketData(): Record<string, OrderbookData> {
  return {
    'BTC/USD': createMockBook('BTC/USD', 64250.0, 0.5, 85000000),
    'ETH/USD': createMockBook('ETH/USD', 3480.0, 0.2, 45000000),
    'SOL/USD': createMockBook('SOL/USD', 148.5, 0.04, 18000000),
    'NIO/USD': createMockBook('NIO/USD', 5.82, 0.01, 12000000),
    'HYPE/USD': createMockBook('HYPE/USD', 43.120, 0.005, 32000000),
  };
}

export function createMockBook(
  symbol: string,
  midPrice: number,
  tickSize: number,
  volume24h: number
): OrderbookData {
  const bids: OrderbookEntry[] = [];
  const asks: OrderbookEntry[] = [];
  let bidAccum = 0;
  let askAccum = 0;

  for (let i = 1; i <= 8; i++) {
    const bidPrice = Math.round((midPrice - i * tickSize) * 100) / 100;
    const bidSize = Math.round((Math.random() * 2.5 + 0.8) * 100) / 100;
    bidAccum += bidSize;
    bids.push({ price: bidPrice, size: bidSize, total: Math.round(bidAccum * 100) / 100 });

    const askPrice = Math.round((midPrice + i * tickSize) * 100) / 100;
    const askSize = Math.round((Math.random() * 2.5 + 0.8) * 100) / 100;
    askAccum += askSize;
    asks.push({ price: askPrice, size: askSize, total: Math.round(askAccum * 100) / 100 });
  }

  const bestBid = bids[0].price;
  const bestAsk = asks[0].price;
  const spread = Math.round((bestAsk - bestBid) * 100) / 100;
  const spreadBps = Math.round(((spread / midPrice) * 10000) * 10) / 10;

  return {
    symbol,
    lastPrice: midPrice,
    priceChange24h: Math.round((Math.random() * 4 - 1.5) * 100) / 100,
    high24h: Math.round(midPrice * 1.035 * 100) / 100,
    low24h: Math.round(midPrice * 0.965 * 100) / 100,
    volume24h,
    spread,
    spreadBps,
    bids,
    asks,
    recentTrades: [
      {
        id: `TR-${Date.now()}-1`,
        price: midPrice,
        size: 0.45,
        side: 'BUY',
        timestamp: Date.now() - 300,
      },
      {
        id: `TR-${Date.now()}-2`,
        price: bestBid,
        size: 1.12,
        side: 'SELL',
        timestamp: Date.now() - 1200,
      },
    ],
  };
}

export function simulateTick(
  prevMarkets: Record<string, OrderbookData>
): Record<string, OrderbookData> {
  const updated: Record<string, OrderbookData> = {};

  for (const [symbol, book] of Object.entries(prevMarkets)) {
    // Stochastic micro-drift + mean-reversion
    const deltaPct = (Math.random() - 0.499) * 0.0018; // ~0.18% max jitter
    const newMid = Math.max(0.1, Math.round((book.lastPrice * (1 + deltaPct)) * 100) / 100);
    const tickSize = symbol.includes('BTC') ? 0.5 : symbol.includes('ETH') ? 0.1 : 0.01;

    const bids: OrderbookEntry[] = [];
    const asks: OrderbookEntry[] = [];
    let bidAccum = 0;
    let askAccum = 0;

    for (let i = 1; i <= 8; i++) {
      const bidPrice = Math.round((newMid - i * tickSize) * 100) / 100;
      const bidSize = Math.round((Math.random() * 3.0 + 0.5) * 100) / 100;
      bidAccum += bidSize;
      bids.push({ price: bidPrice, size: bidSize, total: Math.round(bidAccum * 100) / 100 });

      const askPrice = Math.round((newMid + i * tickSize) * 100) / 100;
      const askSize = Math.round((Math.random() * 3.0 + 0.5) * 100) / 100;
      askAccum += askSize;
      asks.push({ price: askPrice, size: askSize, total: Math.round(askAccum * 100) / 100 });
    }

    const spread = Math.round((asks[0].price - bids[0].price) * 100) / 100;
    const spreadBps = Math.round(((spread / newMid) * 10000) * 10) / 10;

    const newTrades = [...book.recentTrades];
    if (Math.random() > 0.4) {
      newTrades.unshift({
        id: `TR-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        price: Math.random() > 0.5 ? asks[0].price : bids[0].price,
        size: Math.round((Math.random() * 1.8 + 0.1) * 100) / 100,
        side: Math.random() > 0.5 ? 'BUY' : 'SELL',
        timestamp: Date.now(),
      });
      if (newTrades.length > 15) newTrades.pop();
    }

    updated[symbol] = {
      ...book,
      lastPrice: newMid,
      spread,
      spreadBps,
      bids,
      asks,
      recentTrades: newTrades,
    };
  }

  return updated;
}

export function executeVerdict(
  verdict: JudgeVerdict,
  portfolio: PortfolioState,
  marketBook: OrderbookData | undefined
): {
  updatedPortfolio: PortfolioState;
  executedOrder?: ExecutionOrder;
} {
  if (verdict.status === 'REJECTED' || verdict.approvedSizeUsd <= 0) {
    return { updatedPortfolio: portfolio };
  }

  const currentPrice = marketBook?.lastPrice || 100;
  const quantity = Math.round((verdict.approvedSizeUsd / currentPrice) * 1000) / 1000;
  if (quantity <= 0) return { updatedPortfolio: portfolio };

  // Model realistic slippage based on execution route
  const slippageBps =
    verdict.executionRoute === 'DIRECT_DMA'
      ? Math.random() * 1.5 + 0.8
      : verdict.executionRoute === 'TWAP_SLICER'
      ? Math.random() * 0.8 + 0.3
      : Math.random() * 1.0 + 0.5;

  const slippageMultiplier =
    verdict.direction === 'LONG' ? 1 + slippageBps / 10000 : 1 - slippageBps / 10000;
  const filledPrice = Math.round(currentPrice * slippageMultiplier * 100) / 100;
  const feeUsd = Math.round(verdict.approvedSizeUsd * 0.0003 * 100) / 100; // 3 bps maker/taker fee

  const executedOrder: ExecutionOrder = {
    id: `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    signalId: verdict.signalId,
    timestamp: Date.now(),
    symbol: verdict.symbol,
    side: verdict.direction === 'LONG' ? 'BUY' : 'SELL',
    quantity,
    filledPrice,
    slippageBps: Math.round(slippageBps * 10) / 10,
    feeUsd,
    status: 'FILLED',
    executionRoute: verdict.executionRoute,
  };

  // Update or create position
  const existingPosIndex = portfolio.positions.findIndex((p) => p.symbol === verdict.symbol);
  let newPositions = [...portfolio.positions];

  const stopDistancePct = 0.025; // 2.5% stop loss
  const tpDistancePct = 0.055; // 5.5% take profit
  const stopLossPrice =
    verdict.direction === 'LONG'
      ? filledPrice * (1 - stopDistancePct)
      : filledPrice * (1 + stopDistancePct);
  const takeProfitPrice =
    verdict.direction === 'LONG'
      ? filledPrice * (1 + tpDistancePct)
      : filledPrice * (1 - tpDistancePct);

  if (existingPosIndex >= 0) {
    const existing = newPositions[existingPosIndex];
    if (existing.direction === verdict.direction) {
      // Scale into position
      const totalQty = existing.quantity + quantity;
      const blendedEntry =
        (existing.entryPrice * existing.quantity + filledPrice * quantity) / totalQty;
      newPositions[existingPosIndex] = {
        ...existing,
        quantity: Math.round(totalQty * 1000) / 1000,
        entryPrice: Math.round(blendedEntry * 100) / 100,
        allocatedUsd: existing.allocatedUsd + verdict.approvedSizeUsd,
      };
    } else {
      // Opposite direction closes or reduces position
      const pnl =
        existing.direction === 'LONG'
          ? (filledPrice - existing.entryPrice) * Math.min(existing.quantity, quantity)
          : (existing.entryPrice - filledPrice) * Math.min(existing.quantity, quantity);

      if (quantity >= existing.quantity) {
        // Closed position completely
        newPositions.splice(existingPosIndex, 1);
      } else {
        newPositions[existingPosIndex] = {
          ...existing,
          quantity: Math.round((existing.quantity - quantity) * 1000) / 1000,
          allocatedUsd: Math.max(0, existing.allocatedUsd - verdict.approvedSizeUsd),
        };
      }
    }
  } else {
    // Add new position
    newPositions.push({
      symbol: verdict.symbol,
      direction: verdict.direction === 'LONG' ? 'LONG' : 'SHORT',
      quantity,
      entryPrice: filledPrice,
      currentPrice: filledPrice,
      unrealizedPnl: 0,
      unrealizedPnlPct: 0,
      allocatedUsd: verdict.approvedSizeUsd,
      openedAt: Date.now(),
      strategyId: verdict.strategyId,
      stopLossPrice: Math.round(stopLossPrice * 100) / 100,
      takeProfitPrice: Math.round(takeProfitPrice * 100) / 100,
    });
  }

  // Update cash and NAV
  const newCash = portfolio.cashUsd - feeUsd;
  const updatedPortfolio = recalculatePortfolio({
    ...portfolio,
    cashUsd: newCash,
    positions: newPositions,
    totalTrades: portfolio.totalTrades + 1,
  }, { [verdict.symbol]: marketBook || createMockBook(verdict.symbol, filledPrice, 0.1, 1000000) });

  return { updatedPortfolio, executedOrder };
}

export function recalculatePortfolio(
  portfolio: PortfolioState,
  markets: Record<string, OrderbookData>
): PortfolioState {
  let unrealizedTotal = 0;
  let totalAllocated = 0;
  let netExposure = 0;

  const updatedPositions = portfolio.positions.map((pos) => {
    const book = markets[pos.symbol];
    const currentPrice = book ? book.lastPrice : pos.currentPrice;
    const priceDiff = pos.direction === 'LONG' ? currentPrice - pos.entryPrice : pos.entryPrice - currentPrice;
    const pnl = priceDiff * pos.quantity;
    const pnlPct = (priceDiff / pos.entryPrice) * 100;
    unrealizedTotal += pnl;
    totalAllocated += pos.allocatedUsd;
    netExposure += pos.direction === 'LONG' ? pos.allocatedUsd : -pos.allocatedUsd;

    return {
      ...pos,
      currentPrice,
      unrealizedPnl: Math.round(pnl * 100) / 100,
      unrealizedPnlPct: Math.round(pnlPct * 100) / 100,
    };
  });

  const baseCash = 500000;
  const navUsd = Math.round((baseCash + portfolio.realizedPnl + unrealizedTotal) * 100) / 100;
  const grossLeverage = Math.round((totalAllocated / Math.max(navUsd, 1)) * 100) / 100;
  const netLeverage = Math.round((netExposure / Math.max(navUsd, 1)) * 100) / 100;

  const peakNav = Math.max(portfolio.peakNav || navUsd, navUsd);
  const currentDrawdownPct =
    peakNav > 0 ? Math.round((((peakNav - navUsd) / peakNav) * 100) * 100) / 100 : 0;
  const maxDrawdownPct = Math.max(portfolio.maxDrawdownPct || 0, currentDrawdownPct);
  const dailyPnlPct = Math.round((((navUsd - baseCash) / baseCash) * 100) * 100) / 100;

  // Cornish-Fisher VaR and CVaR estimation
  const estPortfolioDailyVol = 0.016; // 1.6% daily portfolio standard deviation
  const var99Usd = Math.round(totalAllocated * estPortfolioDailyVol * 2.33); // 2.33 z-score for 99%
  const cvar99Usd = Math.round(var99Usd * 1.25); // Expected shortfall fat-tailed multiplier

  return {
    ...portfolio,
    navUsd,
    grossLeverage,
    netLeverage,
    unrealizedPnl: Math.round(unrealizedTotal * 100) / 100,
    peakNav,
    currentDrawdownPct,
    maxDrawdownPct,
    dailyPnlPct,
    var99Usd,
    cvar99Usd,
    positions: updatedPositions,
  };
}

export function createInitialPortfolio(): PortfolioState {
  return {
    cashUsd: 500000,
    navUsd: 500000,
    grossLeverage: 0,
    netLeverage: 0,
    realizedPnl: 0,
    unrealizedPnl: 0,
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    peakNav: 500000,
    currentDrawdownPct: 0,
    maxDrawdownPct: 0.42,
    dailyPnlPct: 0,
    sharpeRatio: 2.82,
    var99Usd: 8400,
    cvar99Usd: 11200,
    positions: [
      {
        symbol: 'BTC/USD',
        direction: 'LONG',
        quantity: 0.42,
        entryPrice: 63800.0,
        currentPrice: 64250.0,
        unrealizedPnl: 189.0,
        unrealizedPnlPct: 0.71,
        allocatedUsd: 26800,
        openedAt: Date.now() - 450000,
        strategyId: 'strat_alpha_momentum',
        stopLossPrice: 62205.0,
        takeProfitPrice: 67309.0,
      },
      {
        symbol: 'ETH/USD',
        direction: 'SHORT',
        quantity: 5.5,
        entryPrice: 3512.0,
        currentPrice: 3480.0,
        unrealizedPnl: 176.0,
        unrealizedPnlPct: 0.91,
        allocatedUsd: 19140,
        openedAt: Date.now() - 720000,
        strategyId: 'strat_sigma_mean_reversion',
        stopLossPrice: 3599.8,
        takeProfitPrice: 3318.8,
      },
    ],
  };
}
