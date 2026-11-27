export type DataProviderId =
  | 'KRAKEN'
  | 'CCXT'
  | 'MEXC'
  | 'CMC'
  | 'PIONEX'
  | 'GAINIUM'
  | 'BINANCE'
  | 'ALPACA'
  | 'ALPHAVANTAGE'
  | 'YAHOO_FINANCE'
  | 'MSN_FINANCE';

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
  category: 'CRYPTO_SPOT' | 'CRYPTO_PERP' | 'CRYPTO_DEX' | 'EQUITY' | 'FOREX';
  cmcRank?: number;
  price: number;
  change24hPct: number;
  volume24hUsd: number;
  marketCapUsd?: number;
  rvol: number;
  spreadBps: number;
  high24h: number;
  low24h: number;
  vwap: number;
  atr: number;
  zScore: number;
  cosPhi: number;
  signalTag:
    | 'VWAP CROSS'
    | 'HIGH OF DAY'
    | 'RVOL SPIKE'
    | 'Z-SCORE BREAK'
    | 'SHADOW FLIP'
    | 'CMC TRENDING'
    | 'DEX LIQUIDITY'
    | 'NORMAL';
  signalDirection: 'LONG' | 'SHORT' | 'NEUTRAL';
  updatedAt: number;
}

export interface ChronicleAnomalyEvent {
  id: string;
  timestamp: number;
  timeFormatted: string;
  symbol: string;
  provider: DataProviderId;
  eventType:
    | 'VWAP'
    | 'HIGH_OF_DAY'
    | 'RVOL_SPIKE'
    | 'ZSCORE_BREAK'
    | 'SHADOW_TRIGGER'
    | 'CAP_GUARD'
    | 'CMC_HEADLINE'
    | 'CMC_DEX_FLOW'
    | 'YAHOO_NEWS'
    | 'MSN_NEWS'
    | 'PIONEX_SCAN';
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

// ============================================================================
// COINMARKETCAP (CMC) MARKET INTELLIGENCE, RANKINGS, DEX & EXCHANGE TYPES
// ============================================================================

export type CmcDexNetwork = 'SOLANA' | 'ETHEREUM' | 'BASE' | 'BSC';

export interface CmcGlobalMetrics {
  totalMarketCapUsd: number;
  totalMarketCapChange24hPct: number;
  totalVolume24hUsd: number;
  totalVolumeChange24hPct: number;
  dexVolume24hUsd: number;
  defiMarketCapUsd: number;
  btcDominancePct: number;
  ethDominancePct: number;
  activeCryptocurrencies: number;
  activeExchanges: number;
  activeMarketPairs: number;
  fearAndGreedIndex: number; // 0..100
  fearAndGreedLabel: 'EXTREME FEAR' | 'FEAR' | 'NEUTRAL' | 'GREED' | 'EXTREME GREED';
  altcoinSeasonIndex: number;
  updatedAt: number;
}

export interface CmcRankedAsset {
  cmcRank: number;
  symbol: string;
  name: string;
  slug: string;
  category: 'LAYER1' | 'DEFI' | 'AI' | 'MEME' | 'INFRA' | 'EXCHANGE';
  price: number;
  change1hPct: number;
  change24hPct: number;
  change7dPct: number;
  marketCapUsd: number;
  volume24hUsd: number;
  volumeMcRatioPct: number;
  dominancePct: number;
  turnoverScore: number;
  tag: 'TOP_GAINER' | 'TOP_LOSER' | 'HIGH_VOL' | 'TRENDING' | 'CORE';
}

export interface CmcDexPair {
  id: string;
  pairSymbol: string; // e.g., BONK/SOL, BRETT/ETH, AERO/USDC, CAKE/BNB
  baseToken: string;
  quoteToken: string;
  dexName: string; // e.g., Raydium CLMM, Uniswap v3, Aerodrome, PancakeSwap v3
  network: CmcDexNetwork;
  poolAddress: string;
  priceUsd: number;
  change1hPct: number;
  change24hPct: number;
  liquidityUsd: number;
  volume24hUsd: number;
  fdvUsd: number;
  txns24hBuys: number;
  txns24hSells: number;
  feeTierBps: number;
  securityScore: number;
}

export interface CmcExchangeRanking {
  rank: number;
  exchangeId: string;
  name: string;
  type: 'CEX' | 'DEX';
  volume24hUsd: number;
  change24hPct: number;
  liquidityScore: number; // 0..1000 CMC Liquidity Score
  marketPairsCount: number;
  weeklyVisits: number;
  proofOfReservesUsd: number;
  porVerified: boolean;
  topPair: string;
  makerFeeBps: number;
  takerFeeBps: number;
}

export interface CmcCommunitySignal {
  id: string;
  timestamp: number;
  timeFormatted: string;
  symbol: string;
  category: 'TRENDING' | 'HEADLINE' | 'WHALE_ALERT' | 'DEX_FLOW' | 'COMMUNITY_VOTE';
  headline: string;
  summary: string;
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  bullishVotesPct: number;
  source: string;
}

export interface CmcIntelligencePayload {
  sourceMode: 'CMC_PRO_API' | 'CMC_PUBLIC_API';
  apiKeyConfigured: boolean;
  cascadePosition: number; // 3 (1. Kraken -> 2. CCXT -> 3. CoinMarketCap)
  globalMetrics: CmcGlobalMetrics;
  rankedAssets: CmcRankedAsset[];
  dexPairs: CmcDexPair[];
  exchanges: CmcExchangeRanking[];
  signals: CmcCommunitySignal[];
}

// ============================================================================
// LIVE VOICE-OUT COMMENTATOR, TEACHABLE VOICE COMMANDS & CUSTOM EVENT CLIPS
// ============================================================================

export type CommentaryCategory =
  | 'CHRONICLE'
  | 'HEADLINE'
  | 'DEX_FLOW'
  | 'MARKET_PULSE';

export interface CommentaryMetaFactsContext {
  fearAndGreedIndex?: number;
  fearAndGreedLabel?: string;
  btcDominancePct?: number;
  ethDominancePct?: number;
  totalMarketCapUsd?: number;
  dexVolume24hUsd?: number;
  cmcRank?: number;
  assetChange24hPct?: number;
  assetTag?: string;
  matchingHeadline?: string;
  matchingCommunitySummary?: string;
  matchingCommunityVotesPct?: number;
  matchingDexPair?: {
    pairSymbol: string;
    dexName: string;
    network: string;
    liquidityUsd: number;
    volume24hUsd: number;
    txns24hBuys: number;
    txns24hSells: number;
    securityScore: number;
  };
  topExchangeName?: string;
  topExchangeLiquidityScore?: number;
}

export interface CommentaryGenerateRequest {
  eventId: string;
  category: CommentaryCategory;
  eventType?:
    | ChronicleAnomalyEvent['eventType']
    | 'MARKET_PULSE'
    | 'COMMUNITY_SIGNAL'
    | 'AGENT_PERSONA'
    | 'AGENT_CONVERGENCE';
  symbol: string;
  provider?: string;
  headline: string;
  detail?: string;
  price?: number;
  rvol?: number;
  changePct?: number;
  severity?: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'WARNING';
  metaFacts?: CommentaryMetaFactsContext;
}

export interface CommentaryGenerateResponse {
  eventId: string;
  spokenText: string;
  metaFactSummary: string;
  generatedBy: 'gemini' | 'template';
  modelUsed?: string;
  upstreamNote?: string;
  cached?: boolean;
}

export interface CommentaryBroadcastItem {
  id: string;
  eventId: string;
  timestamp: number;
  timeFormatted: string;
  symbol: string;
  category: CommentaryCategory;
  eventType: string;
  sourceLabel: string;
  headline: string;
  spokenText: string;
  metaFactSummary: string;
  generatedBy: 'gemini' | 'template' | 'custom_clip';
  status: 'QUEUED' | 'GENERATING' | 'SPEAKING' | 'DONE' | 'SKIPPED';
}

export type VoiceCommandActionId =
  | 'TOGGLE_PAUSE'
  | 'SKIP_EVENT'
  | 'REPLAY_LAST'
  | 'TOGGLE_FULLSCREEN'
  | 'READ_CMC_PULSE'
  | 'FOCUS_LATEST_SYMBOL'
  | 'CUSTOM_SPEAK';

export interface VoiceCommandBinding {
  id: string;
  actionId: VoiceCommandActionId;
  label: string;
  description: string;
  phrases: string[];
  audioSignature?: number[];
  audioDurationMs?: number;
  customResponseText?: string;
  enabled: boolean;
  isBuiltin: boolean;
  lastTrainedAt?: number;
}

export type TeachableEventClipCategory =
  | 'BROADCAST_INTRO'
  | 'RVOL_SPIKE'
  | 'VWAP'
  | 'HIGH_OF_DAY'
  | 'ZSCORE_BREAK'
  | 'CMC_HEADLINE'
  | 'CMC_DEX_FLOW'
  | 'SHADOW_TRIGGER';

export type CustomClipPlaybackMode = 'INTRO_BEFORE_VOICE' | 'REPLACE_VOICE';

export interface CustomEventAudioClipMeta {
  eventType: TeachableEventClipCategory;
  label: string;
  description: string;
  hasAudio: boolean;
  mimeType: string;
  durationMs: number;
  playbackMode: CustomClipPlaybackMode;
  enabled: boolean;
  updatedAt: number;
}

// ============================================================================
// PIONEX UNIVERSE SCANNER (@pionex/pionex-ai-kit) & YAHOO / MSN FINANCE NEWS
// ============================================================================

export type PionexMarketType = 'SPOT' | 'PERP';

export type PionexSignalTag =
  | 'PIONEX RVOL'
  | 'TOP GAINER'
  | 'TOP LOSER'
  | 'PERP SURGE'
  | 'BREAKOUT'
  | 'NORMAL';

export interface PionexMarketTicker {
  symbol: string; // e.g., BTC_USDT, SOL_USDT_PERP
  canonicalSymbol: string; // e.g., BTC/USDT, SOLUSDT.P
  baseAsset: string;
  marketType: PionexMarketType;
  price: number;
  open24h: number;
  high24h: number;
  low24h: number;
  change24hPct: number;
  rangePct: number;
  volume24hBase: number;
  amount24hUsd: number;
  tradeCount24h: number;
  rvolScore: number;
  signalTag: PionexSignalTag;
  updatedAt: number;
}

export interface PionexUniversePayload {
  sourceMode: 'PIONEX_PUBLIC_API' | 'PIONEX_CACHED';
  aiKitInstalled: boolean;
  aiKitGlobalCliReady: boolean;
  aiKitVersion: string | null;
  totalUsdtMarkets: number;
  spotCount: number;
  perpCount: number;
  anomaliesCount: number;
  totalVolume24hUsd: number;
  scanLatencyMs: number;
  scannedAt: number;
  tickers: PionexMarketTicker[];
}

export type FinanceNewsProvider = 'YAHOO_FINANCE' | 'MSN_FINANCE';

export interface FinanceNewsItem {
  id: string;
  provider: FinanceNewsProvider;
  sourceLabel: string;
  title: string;
  summary: string;
  symbol: string;
  publishedAt: number;
  timeFormatted: string;
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  link: string;
}

export interface FinanceNewsPayload {
  yahooCount: number;
  msnCount: number;
  fetchedAt: number;
  items: FinanceNewsItem[];
}

// ============================================================================
// QWENTTS.CPP BACKEND TTS BRIDGE & PROP FIRM CHALLENGE SIMULATOR
// ============================================================================

export type TtsEngineMode = 'AUTO' | 'GOOGLE_NATURAL' | 'QWENTTS' | 'BROWSER';

export interface GoogleNaturalVoiceMeta {
  id: string;
  label: string;
  style: string;
  pitchHint: string;
}

export interface GoogleTtsStatus {
  available: boolean;
  model: string;
  defaultVoice: string;
  voices: GoogleNaturalVoiceMeta[];
}

export interface TtsBackendStatus {
  configured: boolean;
  reachable: boolean;
  serverUrl: string;
  repoInstalled: boolean;
  builtBinaryFound: boolean;
  activeModel: string | null;
  speakers: string[];
  registeredVoices: string[];
  lastCheckedAt: number;
  note: string;
  googleTts?: GoogleTtsStatus;
}

export type PropFirmDrawdownMode = 'STATIC' | 'TRAILING_EOD' | 'TRAILING_INTRADAY';

export interface PropFirmPreset {
  id: string;
  firmName: string;
  challengeName: string;
  category: 'CFD' | 'FUTURES' | 'CRYPTO';
  accountSizeUsd: number;
  feeUsd: number;
  phase1TargetPct: number;
  phase2TargetPct: number; // 0 = 1-Step Evaluation
  maxDailyLossPct: number;
  maxTotalLossPct: number;
  drawdownMode: PropFirmDrawdownMode;
  minTradingDays: number;
  maxTradingDays: number;
  consistencyMaxDayPct: number; // 0 = disabled, e.g., 30 = max 30% of total profit in one day
  payoutTargetPct: number;
}

export interface PropFirmSimConfig {
  preset: PropFirmPreset;
  winRatePct: number;
  avgWinR: number;
  avgLossR: number;
  riskPerTradePct: number;
  tradesPerDay: number;
  numPaths: number;
  seed: number;
}

export interface PropFirmSamplePath {
  id: number;
  outcome: 'PASSED_FUNDED' | 'FAILED_PHASE_1' | 'FAILED_PHASE_2' | 'FAILED_FUNDED' | 'TIMED_OUT';
  finalEquityUsd: number;
  equitySeries: number[];
}

export interface PropFirmRiskSweepPoint {
  riskPct: number;
  passPct: number;
  breachDailyPct: number;
  breachTotalPct: number;
  expectedAttempts: number;
  expectedNetEvUsd: number;
}

export interface PropFirmSimulationResult {
  passPhase1Pct: number;
  passPhase2Pct: number;
  passAllPct: number;
  failDailyLossPct: number;
  failMaxLossPct: number;
  timeoutPct: number;
  avgDaysToPass: number;
  expectedAttempts: number;
  expectedTotalFeeUsd: number;
  expectedNetEvUsd: number;
  optimalRiskPct: number;
  samplePaths: PropFirmSamplePath[];
  riskSweep: PropFirmRiskSweepPoint[];
  computedAt: number;
}

export interface PropFirmAttemptTrade {
  tradeNum: number;
  day: number;
  phase: 1 | 2 | 3; // 3 = Funded
  isWin: boolean;
  rMultiple: number;
  pnlUsd: number;
  equityAfterUsd: number;
  drawdownFloorUsd: number;
  dailyFloorUsd: number;
  statusNote: string;
}

export interface PropFirmLiveAttempt {
  seed: number;
  presetSnapshot: PropFirmPreset;
  phase: 1 | 2 | 3;
  day: number;
  phaseDay: number;
  equityUsd: number;
  highWaterMarkUsd: number;
  drawdownFloorUsd: number;
  dayStartEquityUsd: number;
  dailyFloorUsd: number;
  phaseTargetUsd: number;
  bestSingleDayProfitUsd: number;
  consistencyPct: number;
  outcome: 'ACTIVE' | 'PASSED_FUNDED' | 'FAILED_DAILY_LOSS' | 'FAILED_MAX_DRAWDOWN' | 'TIMED_OUT';
  breachReason: string | null;
  trades: PropFirmAttemptTrade[];
  equityHistory: number[];
  floorHistory: number[];
  dailyFloorHistory: number[];
}

// ============================================================================
// 30-MINUTE KEY TAKEAWAY FORECAST & TV STUDIO LIVE CHAT Q&A
// ============================================================================

export interface KeyTakeawayTradeRecommendation {
  rank: number; // 1..5
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: string;
  stopLoss: string;
  takeProfit: string;
  riskRewardRatio: string;
  confidence: 'HIGH' | 'MEDIUM';
  catalyst: string;
}

export interface KeyTakeawayMover {
  symbol: string;
  price: number;
  changePct: number;
  note: string;
}

export interface KeyTakeawayHeadline {
  source: string;
  symbol: string;
  title: string;
}

export interface KeyTakeawayReport {
  id: string;
  generatedAt: number;
  timeFormatted: string;
  nextScheduledAt: number;
  marketRegime: 'BULLISH' | 'BEARISH' | 'VOLATILE' | 'RANGE';
  forecastBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  forecast30mSummary: string;
  topMoversSummary: KeyTakeawayMover[];
  keyHeadlines: KeyTakeawayHeadline[];
  recommendations: KeyTakeawayTradeRecommendation[];
  spokenAnnouncement: string;
  generatedBy: 'gemini' | 'deterministic';
  modelUsed?: string;
  upstreamNote?: string;
}

export type StudioChatSource = 'STUDIO' | 'YOUTUBE';
export type StudioChatStatus = 'NEW' | 'QUEUED' | 'ANSWERED' | 'SKIPPED';

export interface StudioChatMessage {
  id: string;
  source: StudioChatSource;
  author: string;
  text: string;
  timestamp: number;
  timeFormatted: string;
  isQuestion: boolean;
  status: StudioChatStatus;
  answerText?: string;
  answeredAt?: number;
  answeredBy?: 'gemini' | 'deterministic';
}

export interface StudioLiveChatState {
  youtubeConnected: boolean;
  youtubeVideoId: string | null;
  youtubeTitle: string | null;
  youtubeMode: 'DATA_API' | 'PUBLIC_POLL' | 'DISCONNECTED';
  lastPollAt: number | null;
  pollError: string | null;
  autoAnswerQuestions: boolean;
  messages: StudioChatMessage[];
}

// ============================================================================
// HYBRID 5-AGENT CONVERGENCE & MULTISENSORY EXECUTION ENGINE
// ============================================================================

export type AgentPersonaId =
  | 'STRATEGIST'
  | 'SKEPTIC'
  | 'MEAN_REVERSION'
  | 'TREND_FOLLOWER'
  | 'NEWS_TRADER';

export type AgentGroupRole = 'RISK_CORSET' | 'ADAPTIVE';
export type AgentStance = 'LONG' | 'SHORT' | 'NEUTRAL' | 'VETO';
export type AgentConvergenceTrigger =
  | 'TELEPROMPTER'
  | 'RVOL_SPIKE'
  | 'MACRO_EVENT'
  | 'MANUAL';

export interface AgentPersonaMeta {
  id: AgentPersonaId;
  name: string;
  shortLabel: string;
  group: AgentGroupRole;
  googleVoice: 'Charon' | 'Kore' | 'Zephyr' | 'Fenrir' | 'Puck';
  voicePitch: number;
  voiceRate: number;
  speechStyle: string;
  description: string;
}

export interface PureTeleprompterContext {
  rawScriptText: string;
  extractedPrompt: string;
  symbol: string;
  price: number;
  change24hPct: number;
  rvol: number;
  fearAndGreedIndex: number;
  macroHeadline: string;
  charCount: number;
  estTokens: number;
}

export interface AgentVote {
  agentId: AgentPersonaId;
  agentName: string;
  group: AgentGroupRole;
  googleVoice: 'Charon' | 'Kore' | 'Zephyr' | 'Fenrir' | 'Puck';
  voicePitch: number;
  voiceRate: number;
  speechStyle: string;
  stance: AgentStance;
  confidence: number; // 0..100
  thesis: string;
  riskNote: string;
  latencyMs: number;
  generatedBy: 'gemini' | 'deterministic';
}

export interface AgentTradeSetup {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  entryStr: string;
  stopLossStr: string;
  takeProfitStr: string;
  riskRewardRatio: number;
  riskRewardStr: string;
  suggestedSizePct: number;
}

export interface AgentPaperExecutionRecord {
  id: string;
  decisionId: string;
  timestamp: number;
  timeFormatted: string;
  symbol: string;
  side: 'buy' | 'sell';
  direction: 'LONG' | 'SHORT';
  price: number;
  vol: number;
  costUsd: number;
  stopLoss: number;
  takeProfit: number;
  status: 'EXECUTED' | 'SKIPPED' | 'BLOCKED';
  reason: string;
}

export interface AgentExecutionConfig {
  autoExecuteEnabled: boolean;
  minConvergencePct: number; // 55..95
  maxRiskPctPerTrade: number; // 1..10
  cooldownSecPerSymbol: number; // 60..3600
  autoSpeakDebate: boolean;
}

export interface AgentConvergenceDecision {
  id: string;
  timestamp: number;
  timeFormatted: string;
  trigger: AgentConvergenceTrigger;
  context: PureTeleprompterContext;
  votes: AgentVote[];
  convergencePct: number;
  consensusDirection: 'LONG' | 'SHORT' | 'WAIT';
  riskCorsetVetoed: boolean;
  vetoReason?: string;
  tradeSetup: AgentTradeSetup | null;
  spokenSummary: string;
  totalLatencyMs: number;
  executionRecord?: AgentPaperExecutionRecord;
}

export interface AgentConvergenceState {
  latest: AgentConvergenceDecision | null;
  history: AgentConvergenceDecision[];
  executions: AgentPaperExecutionRecord[];
  config: AgentExecutionConfig;
  personas: AgentPersonaMeta[];
}

