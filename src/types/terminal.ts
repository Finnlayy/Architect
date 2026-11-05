export type DataProviderId =
  | 'KRAKEN'
  | 'CCXT'
  | 'GAINIUM'
  | 'BINANCE'
  | 'ALPACA'
  | 'ALPHAVANTAGE';

export type TimeframeId = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export type ExitModeId = 'TP_LADDER' | 'AUTO_TP_MFE' | 'FRACTAL_TP' | 'TRAILING_STOP';

export type TradeDirectionMode = 'BOTH' | 'LONG' | 'SHORT';

export interface OHLCVCandle {
  time: number; // Unix timestamp in ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap?: number;
  emaFast?: number;
  emaSlow?: number;
  atr?: number;
  zScore?: number;
  cosPhi?: number;
}

export interface ProviderAttemptTrace {
  provider: DataProviderId;
  attemptedAt: number;
  latencyMs: number;
  status: 'SUCCESS' | 'FALLBACK_NEXT' | 'KEY_MISSING' | 'SYMBOL_UNLISTED' | 'ERROR';
  endpoint: string;
  message: string;
  candlesCount?: number;
}

export interface StrategyAdvancedParams {
  fastPeriod: number;
  slowPeriod: number;
  zScoreThreshold: number;
  cosPhiThreshold: number;
  profitLockGivebackR: number;
  mfeQuantileWindow: number;
  mfeQuantileTarget: number;
  enableShadowEngine: boolean;
  maxSpreadBpsGuard: number;
}

export interface StrategyDefinition {
  id: string;
  name: string;
  templateType: 'SNIPER_FUSION' | 'MTF_CISD' | 'FLIP_SENSOR_1M' | 'SIGMA_ZSCORE' | 'ATR_BREAKOUT' | 'CUSTOM';
  idea: string;
  symbol: string;
  timeframe: TimeframeId;
  lookbackBars: number;
  direction: TradeDirectionMode;
  initialCapital: number; // Default: 1000 ($1,000 Paper Account)
  maxConcurrentTrades: number; // Default & Hard Cap: 20
  riskPerTradePct: number; // e.g., 2.0%
  leverage: number; // e.g., 5x
  feePct: number; // e.g., 0.05%
  slippageBps: number; // e.g., 2.0 bps
  slAtrMult: number; // e.g., 1.8x ATR
  tpRMultiple: number; // e.g., 2.5R
  exitMode: ExitModeId;
  advanced: StrategyAdvancedParams;
  updatedAt: number;
}

export interface BacktestTrade {
  id: string;
  tradeNumber: number;
  symbol: string;
  provider: DataProviderId;
  side: 'LONG' | 'SHORT';
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  quantity: number;
  notionalUsd: number;
  sizePctEquity: number;
  grossPnlUsd: number;
  feeUsd: number;
  slippageUsd: number;
  netPnlUsd: number;
  returnPct: number;
  rMultiple: number;
  mfePct: number;
  maePct: number;
  exitReason: 'TP' | 'SL' | 'TRAIL' | 'EARLY_OPP' | 'END_OF_DATA';
  reasonDetail: string;
  cosPhiAtEntry: number;
  concurrentSlot: number; // 1..20
}

export interface PipelineLogEvent {
  id: string;
  timestamp: number;
  action: 'ENTER' | 'EXIT' | 'FILTERED';
  symbol: string;
  side: 'LONG' | 'SHORT';
  price: number;
  sizePctEquity: number;
  pnlUsd?: number;
  returnPct?: number;
  reason: string;
  stage: 'SCANNER' | 'CHECK' | 'SIZER' | 'EXECUTOR' | 'LOGGER';
  activeSlots: number;
}

export interface EquityCurvePoint {
  time: number;
  equity: number;
  drawdownPct: number;
  drawdownUsd: number;
  shadowEquity: number;
  openTradesCount: number;
  price: number;
}

export interface ShadowEngineSummary {
  enabled: boolean;
  currentCosPhi: number;
  phaseState: 'ACTIVE_POWER' | 'REACTIVE_CHOP' | 'REGIME_FLIP';
  inverseNetPnlUsd: number;
  inverseReturnPct: number;
  inverseWinRatePct: number;
  shadowStopsBrokenCount: number;
  adaptiveMfeQuantileR: number;
  recommendation: string;
}

export interface BacktestPerformanceMetrics {
  initialCapital: number;
  finalEquity: number;
  netProfitUsd: number;
  netReturnPct: number;
  grossProfitUsd: number;
  grossLossUsd: number;
  totalFeesUsd: number;
  profitFactor: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  avgWinUsd: number;
  avgLossUsd: number;
  expectancyUsd: number;
  sharpeRatio: number;
  sortinoRatio: number;
  tradeQualityMuSigma: number;
  maxDrawdownPct: number;
  maxDrawdownUsd: number;
  recoveryFactor: number;
  avgMfePct: number;
  avgMaePct: number;
  peakConcurrentTrades: number;
  maxConcurrentLimit: number;
  filteredSignalsCount: number;
  filteredByMax20Cap: number;
  filteredByCosPhiChop: number;
  exitDistribution: {
    TP: number;
    SL: number;
    TRAIL: number;
    EARLY_OPP: number;
    END_OF_DATA: number;
  };
}

export interface BacktestResult {
  runId: string;
  strategyId: string;
  strategyName: string;
  symbol: string;
  timeframe: TimeframeId;
  activeProvider: DataProviderId;
  cascadeTrace: ProviderAttemptTrace[];
  executedAt: number;
  executionDurationMs: number;
  candles: OHLCVCandle[];
  trades: BacktestTrade[];
  pipelineEvents: PipelineLogEvent[];
  equityCurve: EquityCurvePoint[];
  metrics: BacktestPerformanceMetrics;
  shadow: ShadowEngineSummary;
  pineScriptV6: string;
}

export interface ScreenerTickerRow {
  symbol: string;
  name: string;
  provider: DataProviderId;
  category: 'CRYPTO_SPOT' | 'CRYPTO_PERP' | 'EQUITY' | 'FOREX';
  price: number;
  change24hPct: number;
  volume24hUsd: number;
  rvol: number;
  spreadBps: number;
  high24h: number;
  low24h: number;
  vwap: number;
  atr: number;
  zScore: number;
  cosPhi: number;
  signalTag: 'VWAP CROSS' | 'HIGH OF DAY' | 'RVOL SPIKE' | 'Z-SCORE BREAK' | 'SHADOW FLIP' | 'NORMAL';
  signalDirection: 'LONG' | 'SHORT' | 'NEUTRAL';
  updatedAt: number;
}

export interface ChronicleAnomalyEvent {
  id: string;
  timestamp: number;
  timeFormatted: string;
  symbol: string;
  provider: DataProviderId;
  eventType: 'VWAP' | 'HIGH_OF_DAY' | 'RVOL_SPIKE' | 'ZSCORE_BREAK' | 'SHADOW_TRIGGER' | 'CAP_GUARD';
  headline: string;
  detail: string;
  price: number;
  rvol: number;
  changePct: number;
  severity: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'WARNING';
}

export interface ScreenerScheduleStatus {
  enabled: boolean;
  intervalSec: number;
  lastRunAt: number;
  nextRunAt: number;
  totalRuns: number;
  activeProviders: DataProviderId[];
  providerHealth: Record<
    DataProviderId,
    {
      status: 'ONLINE' | 'READY_PUBLIC' | 'KEY_OPTIONAL';
      symbolsCount: number;
      avgLatencyMs: number;
      lastCheckedAt: number;
      note: string;
    }
  >;
  tickers: ScreenerTickerRow[];
  chronicle: ChronicleAnomalyEvent[];
}
