/**
 * OMEGA NIO — Live Voice-Out Commentator Orchestrator
 *
 * Manages:
 *  - Event queue & deduplication for Chronicle of Events + CMC Headlines/Community + DEX On-Chain flows
 *  - Strict exclusion of Paper Order Fills & Backtest Results
 *  - Server-side Gemini commentary generation (/api/commentary/generate)
 *  - Custom user-recorded Event Audio Clips (Intro / Replace mode)
 *  - Browser Web Speech Synthesis (de-DE Live Anchor voice) with echo protection & audio ducking
 */
import {
  ChronicleAnomalyEvent,
  CmcCommunitySignal,
  CmcDexPair,
  CmcIntelligencePayload,
  CommentaryBroadcastItem,
  CommentaryGenerateRequest,
  CommentaryMetaFactsContext,
  CustomEventAudioClipMeta,
  FinanceNewsItem,
  KeyTakeawayReport,
  PionexMarketTicker,
  StudioChatMessage,
  TeachableEventClipCategory,
  TtsBackendStatus,
  TtsEngineMode,
  AgentConvergenceDecision,
  AgentVote,
} from '../types/terminal';
import { arcadeSoundEngine } from './arcadeSoundEngine';
import {
  fetchTtsBackendStatus,
  generateBroadcastCommentary,
  synthesizeGoogleNaturalVoiceWav,
  synthesizeQwenTtsWav,
} from './terminalClient';
import { voiceCommandListener } from './voiceCommandListener';
import { loadVoiceTeachData, playCustomEventClipBlob } from './voiceTeachStore';

const VOICE_PREFS_STORAGE_KEY = 'omega_voice_commentator_prefs_v1';
const MAX_QUEUE_LENGTH = 8;
const MAX_HISTORY_LENGTH = 24;
const AUTO_SPEAK_COOLDOWN_MS = 12000;

export interface VoiceCommentatorPrefs {
  voiceName: string;
  speechRate: number; // 0.85 .. 1.35
  speechPitch: number; // 0.9 .. 1.15
  ttsEngineMode: TtsEngineMode;
  qwenSpeaker: string;
  googleVoice: string;
  googleStyle: string;
}

export interface VuMeterReading {
  left: number; // 0..1
  right: number; // 0..1
  peak: number; // 0..1
  activeSource: 'IDLE' | 'GOOGLE_NATURAL' | 'QWENTTS' | 'BROWSER' | 'CLIP';
}

export type VoiceDeskStatus = 'IDLE' | 'GENERATING' | 'SPEAKING' | 'PAUSED';

export interface VoiceCommentatorSnapshot {
  isVoiceModeActive: boolean;
  status: VoiceDeskStatus;
  isPaused: boolean;
  currentItem: CommentaryBroadcastItem | null;
  queue: CommentaryBroadcastItem[];
  history: CommentaryBroadcastItem[];
  availableVoices: { name: string; lang: string }[];
  prefs: VoiceCommentatorPrefs;
  ttsStatus: TtsBackendStatus | null;
  lastTtsProviderUsed: 'GOOGLE_NATURAL' | 'QWENTTS' | 'BROWSER' | 'CLIP';
  lastError: string | null;
  speechSupported: boolean;
}

type SnapshotListener = (snap: VoiceCommentatorSnapshot) => void;
type VuListener = (vu: VuMeterReading) => void;

const BLOCKED_EVENT_TERMS = [
  'paper',
  'order_fill',
  'backtest',
  'take_profit',
  'stop_loss',
  'bt equity',
];

function isBlockedPaperOrBacktestEvent(text: string): boolean {
  const lower = text.toLowerCase();
  return BLOCKED_EVENT_TERMS.some((term) => lower.includes(term));
}

function normalizeBaseToken(symbol: string): string {
  return symbol
    .toUpperCase()
    .replace(/USDT\.P|\/USD|\/USDT|\/EUR|USDT|USD/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

function buildMetaFactsContext(
  symbol: string,
  cmcData: CmcIntelligencePayload | null
): CommentaryMetaFactsContext {
  if (!cmcData) return {};
  const baseToken = normalizeBaseToken(symbol);

  const ranked = cmcData.rankedAssets.find(
    (a) => normalizeBaseToken(a.symbol) === baseToken
  );

  const matchingSignal =
    cmcData.signals.find((s) => normalizeBaseToken(s.symbol) === baseToken) ||
    cmcData.signals[0];

  const matchingDex =
    cmcData.dexPairs.find(
      (d) =>
        normalizeBaseToken(d.baseToken) === baseToken ||
        normalizeBaseToken(d.pairSymbol).includes(baseToken)
    ) || cmcData.dexPairs[0];

  const topExchange = cmcData.exchanges[0];

  return {
    fearAndGreedIndex: cmcData.globalMetrics.fearAndGreedIndex,
    fearAndGreedLabel: cmcData.globalMetrics.fearAndGreedLabel,
    btcDominancePct: cmcData.globalMetrics.btcDominancePct,
    ethDominancePct: cmcData.globalMetrics.ethDominancePct,
    totalMarketCapUsd: cmcData.globalMetrics.totalMarketCapUsd,
    dexVolume24hUsd: cmcData.globalMetrics.dexVolume24hUsd,
    cmcRank: ranked?.cmcRank,
    assetChange24hPct: ranked?.change24hPct,
    assetTag: ranked?.tag,
    matchingHeadline: matchingSignal?.headline,
    matchingCommunitySummary: matchingSignal?.summary,
    matchingCommunityVotesPct: matchingSignal?.bullishVotesPct,
    topExchangeName: topExchange?.name,
    topExchangeLiquidityScore: topExchange?.liquidityScore,
    matchingDexPair: matchingDex
      ? {
          pairSymbol: matchingDex.pairSymbol,
          dexName: matchingDex.dexName,
          network: matchingDex.network,
          liquidityUsd: matchingDex.liquidityUsd,
          volume24hUsd: matchingDex.volume24hUsd,
          txns24hBuys: matchingDex.txns24hBuys,
          txns24hSells: matchingDex.txns24hSells,
          securityScore: matchingDex.securityScore,
        }
      : undefined,
  };
}

class LiveVoiceCommentatorService {
  private speechSupported =
    typeof window !== 'undefined' && 'speechSynthesis' in window;
  private listeners: Set<SnapshotListener> = new Set();
  private seenEventIds: Set<string> = new Set();
  private queue: Array<{
    req: CommentaryGenerateRequest;
    clipCategory: TeachableEventClipCategory;
    sourceLabel: string;
    forceImmediate?: boolean;
    pregeneratedText?: string;
    pregeneratedMetaSummary?: string;
    pregeneratedBy?: 'gemini' | 'template';
    voiceOverride?: {
      googleVoice?: string;
      googleStyle?: string;
      speechPitch?: number;
      speechRate?: number;
    };
  }> = [];
  private history: CommentaryBroadcastItem[] = [];
  private currentItem: CommentaryBroadcastItem | null = null;
  private isPaused = false;
  private isProcessing = false;
  private lastBroadcastAt = 0;
  private broadcastTimer: number | null = null;
  private introPlayedThisSession = false;
  private activeUtteranceCancel = false;
  private lastError: string | null = null;

  private prefs: VoiceCommentatorPrefs = {
    voiceName: '',
    speechRate: 1.05,
    speechPitch: 1.0,
    ttsEngineMode: 'AUTO',
    qwenSpeaker: 'ryan',
    googleVoice: 'Kore',
    googleStyle: '',
  };
  private availableVoices: SpeechSynthesisVoice[] = [];
  private ttsStatus: TtsBackendStatus | null = null;
  private lastTtsProviderUsed: 'GOOGLE_NATURAL' | 'QWENTTS' | 'BROWSER' | 'CLIP' = 'BROWSER';
  private vuListeners: Set<VuListener> = new Set();
  private vuReading: VuMeterReading = { left: 0, right: 0, peak: 0, activeSource: 'IDLE' };
  private vuTimer: number | null = null;
  private speechEnvelopeEnergy = 0;
  private activeAudioStopper: (() => void) | null = null;
  private ttsAudioCtx: AudioContext | null = null;

  constructor() {
    this.loadPrefs();
    if (this.speechSupported) {
      this.refreshVoices();
      window.speechSynthesis.addEventListener?.('voiceschanged', () => {
        this.refreshVoices();
      });
    }
    arcadeSoundEngine.subscribePreferences(() => {
      this.emitState();
    });
    if (typeof window !== 'undefined') {
      void this.refreshTtsBackendStatus();
    }
  }

  public async refreshTtsBackendStatus(force = false): Promise<TtsBackendStatus | null> {
    try {
      this.ttsStatus = await fetchTtsBackendStatus(force);
      this.emitState();
      return this.ttsStatus;
    } catch {
      return this.ttsStatus;
    }
  }

  private loadPrefs(): void {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(VOICE_PREFS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.prefs = {
          voiceName: typeof parsed.voiceName === 'string' ? parsed.voiceName : '',
          speechRate:
            typeof parsed.speechRate === 'number'
              ? Math.max(0.8, Math.min(1.4, parsed.speechRate))
              : 1.05,
          speechPitch:
            typeof parsed.speechPitch === 'number'
              ? Math.max(0.85, Math.min(1.2, parsed.speechPitch))
              : 1.0,
          ttsEngineMode:
            parsed.ttsEngineMode === 'GOOGLE_NATURAL' ||
            parsed.ttsEngineMode === 'QWENTTS' ||
            parsed.ttsEngineMode === 'BROWSER'
              ? parsed.ttsEngineMode
              : 'AUTO',
          qwenSpeaker:
            typeof parsed.qwenSpeaker === 'string' && parsed.qwenSpeaker.trim()
              ? parsed.qwenSpeaker.trim()
              : 'ryan',
          googleVoice:
            typeof parsed.googleVoice === 'string' && parsed.googleVoice.trim()
              ? parsed.googleVoice.trim()
              : 'Kore',
          googleStyle: typeof parsed.googleStyle === 'string' ? parsed.googleStyle.trim() : '',
        };
      }
    } catch {
      // keep defaults
    }
  }

  private savePrefs(): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(VOICE_PREFS_STORAGE_KEY, JSON.stringify(this.prefs));
    } catch {
      // ignore
    }
  }

  private refreshVoices(): void {
    if (!this.speechSupported) return;
    const all = window.speechSynthesis.getVoices();
    const scoreVoice = (v: SpeechSynthesisVoice): number => {
      const isDe = v.lang.toLowerCase().startsWith('de');
      const isGoogle = /google/i.test(v.name);
      const isNatural = /natural|neural|online/i.test(v.name);
      const isKnownGoodDe = /katja|conrad|seraphina|florian|anna|hedda|stefan/i.test(v.name);
      return (isDe ? 100 : 0) + (isGoogle ? 40 : 0) + (isNatural ? 30 : 0) + (isKnownGoodDe ? 10 : 0);
    };
    const ordered = [...all].sort((a, b) => scoreVoice(b) - scoreVoice(a));
    this.availableVoices = ordered;
    const german = ordered.filter((v) => v.lang.toLowerCase().startsWith('de'));
    if (!this.prefs.voiceName && german.length > 0) {
      const preferred =
        german.find((v) => /google/i.test(v.name)) ||
        german.find((v) => /natural|neural|online/i.test(v.name)) ||
        german.find((v) => /katja|conrad|seraphina|florian|anna|hedda|stefan/i.test(v.name)) ||
        german[0];
      this.prefs.voiceName = preferred.name;
    }
    this.emitState();
  }

  public isVoiceModeEnabled(): boolean {
    const audioPrefs = arcadeSoundEngine.getPreferences();
    return audioPrefs.enabled && audioPrefs.pack === 'VOICE_COMMENTATOR';
  }

  public activateVoiceMode(): void {
    arcadeSoundEngine.updatePreferences({
      enabled: true,
      pack: 'VOICE_COMMENTATOR',
    });
    this.isPaused = false;
    this.emitState();
  }

  public updatePrefs(patch: Partial<VoiceCommentatorPrefs>): void {
    this.prefs = { ...this.prefs, ...patch };
    this.savePrefs();
    this.emitState();
  }

  public saveAllPreferences(): void {
    this.savePrefs();
    arcadeSoundEngine.updatePreferences(arcadeSoundEngine.getPreferences());
    this.emitState();
  }

  public subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  public subscribeVu(listener: VuListener): () => void {
    this.vuListeners.add(listener);
    listener({ ...this.vuReading });
    return () => {
      this.vuListeners.delete(listener);
    };
  }

  private emitVu(next: VuMeterReading): void {
    this.vuReading = next;
    for (const l of this.vuListeners) {
      try {
        l(next);
      } catch {
        // ignore
      }
    }
  }

  private startBrowserSpeechVuLoop(source: 'BROWSER' | 'CLIP'): void {
    this.stopVuLoop();
    this.speechEnvelopeEnergy = 0.65;
    let tick = 0;
    this.vuTimer = window.setInterval(() => {
      tick++;
      // Syllable-modulated speech cadence damped smoothly
      const cadence = 0.35 + Math.abs(Math.sin(tick * 0.55)) * 0.38 + Math.abs(Math.cos(tick * 0.31)) * 0.18;
      this.speechEnvelopeEnergy = this.speechEnvelopeEnergy * 0.72 + cadence * 0.28;
      const left = Math.max(0.06, Math.min(0.95, this.speechEnvelopeEnergy * (0.94 + Math.sin(tick * 0.8) * 0.06)));
      const right = Math.max(0.06, Math.min(0.95, this.speechEnvelopeEnergy * (0.92 + Math.cos(tick * 0.7) * 0.08)));
      const peak = Math.max(left, right, this.vuReading.peak * 0.94);
      this.emitVu({ left, right, peak, activeSource: source });
    }, 45);
  }

  private stopVuLoop(): void {
    if (this.vuTimer !== null) {
      window.clearInterval(this.vuTimer);
      this.vuTimer = null;
    }
    this.speechEnvelopeEnergy = 0;
    this.emitVu({ left: 0, right: 0, peak: 0, activeSource: 'IDLE' });
  }

  public getSnapshot(): VoiceCommentatorSnapshot {
    const status: VoiceDeskStatus = this.isPaused
      ? 'PAUSED'
      : this.currentItem?.status === 'SPEAKING'
      ? 'SPEAKING'
      : this.currentItem?.status === 'GENERATING' || this.isProcessing
      ? 'GENERATING'
      : 'IDLE';

    return {
      isVoiceModeActive: this.isVoiceModeEnabled(),
      status,
      isPaused: this.isPaused,
      currentItem: this.currentItem ? { ...this.currentItem } : null,
      queue: this.queue.map((q, idx) => ({
        id: `queued-${idx}-${q.req.eventId}`,
        eventId: q.req.eventId,
        timestamp: Date.now(),
        timeFormatted: '--:--:--',
        symbol: q.req.symbol,
        category: q.req.category,
        eventType: q.req.eventType || q.clipCategory,
        sourceLabel: q.sourceLabel,
        headline: q.req.headline,
        spokenText: '',
        metaFactSummary: '',
        generatedBy: 'gemini',
        status: 'QUEUED',
      })),
      history: this.history.map((h) => ({ ...h })),
      availableVoices: this.availableVoices.map((v) => ({
        name: v.name,
        lang: v.lang,
      })),
      prefs: { ...this.prefs },
      ttsStatus: this.ttsStatus ? { ...this.ttsStatus } : null,
      lastTtsProviderUsed: this.lastTtsProviderUsed,
      lastError: this.lastError,
      speechSupported: this.speechSupported,
    };
  }

  private emitState(): void {
    const snap = this.getSnapshot();
    for (const l of this.listeners) {
      try {
        l(snap);
      } catch {
        // ignore
      }
    }
  }

  public enqueueChronicleEvent(
    ev: ChronicleAnomalyEvent,
    cmcData: CmcIntelligencePayload | null,
    forceImmediate = false
  ): void {
    if (!forceImmediate && !this.isVoiceModeEnabled()) return;
    if (
      isBlockedPaperOrBacktestEvent(ev.eventType) ||
      isBlockedPaperOrBacktestEvent(ev.headline) ||
      isBlockedPaperOrBacktestEvent(ev.detail)
    ) {
      return;
    }

    if (!forceImmediate && this.seenEventIds.has(ev.id)) return;
    this.recordSeenEventId(ev.id);

    const clipCategory: TeachableEventClipCategory =
      ev.eventType === 'YAHOO_NEWS' || ev.eventType === 'MSN_NEWS'
        ? 'CMC_HEADLINE'
        : ev.eventType === 'PIONEX_SCAN'
        ? 'RVOL_SPIKE'
        : ev.eventType === 'VWAP' ||
          ev.eventType === 'HIGH_OF_DAY' ||
          ev.eventType === 'RVOL_SPIKE' ||
          ev.eventType === 'ZSCORE_BREAK' ||
          ev.eventType === 'CMC_HEADLINE' ||
          ev.eventType === 'CMC_DEX_FLOW' ||
          ev.eventType === 'SHADOW_TRIGGER'
        ? ev.eventType
        : 'RVOL_SPIKE';

    const category =
      ev.eventType === 'CMC_HEADLINE' ||
      ev.eventType === 'YAHOO_NEWS' ||
      ev.eventType === 'MSN_NEWS'
        ? 'HEADLINE'
        : ev.eventType === 'CMC_DEX_FLOW'
        ? 'DEX_FLOW'
        : 'CHRONICLE';

    const req: CommentaryGenerateRequest = {
      eventId: forceImmediate ? `${ev.id}-MANUAL-${Date.now()}` : ev.id,
      category,
      eventType: ev.eventType,
      symbol: ev.symbol,
      provider: ev.provider,
      headline: ev.headline,
      detail: ev.detail,
      price: ev.price,
      rvol: ev.rvol,
      changePct: ev.changePct,
      severity: ev.severity,
      metaFacts: buildMetaFactsContext(ev.symbol, cmcData),
    };

    this.pushQueueItem({
      req,
      clipCategory,
      sourceLabel: ev.provider,
      forceImmediate,
    });
  }

  public enqueueCommunitySignal(
    signal: CmcCommunitySignal,
    cmcData: CmcIntelligencePayload | null,
    forceImmediate = false
  ): void {
    if (!forceImmediate && !this.isVoiceModeEnabled()) return;
    if (!forceImmediate && this.seenEventIds.has(signal.id)) return;
    this.recordSeenEventId(signal.id);

    const mf = buildMetaFactsContext(signal.symbol, cmcData);
    mf.matchingHeadline = signal.headline;
    mf.matchingCommunitySummary = signal.summary;
    mf.matchingCommunityVotesPct = signal.bullishVotesPct;

    this.pushQueueItem({
      req: {
        eventId: forceImmediate ? `${signal.id}-MANUAL-${Date.now()}` : signal.id,
        category: signal.category === 'DEX_FLOW' ? 'DEX_FLOW' : 'HEADLINE',
        eventType: signal.category === 'DEX_FLOW' ? 'CMC_DEX_FLOW' : 'CMC_HEADLINE',
        symbol: signal.symbol,
        provider: signal.source,
        headline: signal.headline,
        detail: signal.summary,
        severity: signal.sentiment,
        metaFacts: mf,
      },
      clipCategory: signal.category === 'DEX_FLOW' ? 'CMC_DEX_FLOW' : 'CMC_HEADLINE',
      sourceLabel: signal.source,
      forceImmediate,
    });
  }

  public enqueueDexFlowEvent(
    pair: CmcDexPair,
    cmcData: CmcIntelligencePayload | null,
    forceImmediate = false
  ): void {
    const id = `DEX-${pair.id}-${Math.round(pair.volume24hUsd / 10000)}`;
    if (!forceImmediate && !this.isVoiceModeEnabled()) return;
    if (!forceImmediate && this.seenEventIds.has(id)) return;
    this.recordSeenEventId(id);

    const mf = buildMetaFactsContext(pair.baseToken, cmcData);
    mf.matchingDexPair = {
      pairSymbol: pair.pairSymbol,
      dexName: pair.dexName,
      network: pair.network,
      liquidityUsd: pair.liquidityUsd,
      volume24hUsd: pair.volume24hUsd,
      txns24hBuys: pair.txns24hBuys,
      txns24hSells: pair.txns24hSells,
      securityScore: pair.securityScore,
    };

    this.pushQueueItem({
      req: {
        eventId: forceImmediate ? `${id}-MANUAL-${Date.now()}` : id,
        category: 'DEX_FLOW',
        eventType: 'CMC_DEX_FLOW',
        symbol: pair.pairSymbol,
        provider: `${pair.dexName} (${pair.network})`,
        headline: `${pair.pairSymbol} On-Chain Aktivität (${pair.change1hPct >= 0 ? '+' : ''}${pair.change1hPct.toFixed(2)}% 1h)`,
        detail: `Liq $${Math.round(pair.liquidityUsd).toLocaleString('en-US')} · Buys ${pair.txns24hBuys} vs Sells ${pair.txns24hSells}`,
        price: pair.priceUsd,
        changePct: pair.change24hPct,
        severity: pair.change1hPct >= 0 ? 'BULLISH' : 'BEARISH',
        metaFacts: mf,
      },
      clipCategory: 'CMC_DEX_FLOW',
      sourceLabel: `${pair.dexName} · ${pair.network}`,
      forceImmediate,
    });
  }

  public enqueueFinanceNews(
    item: FinanceNewsItem,
    cmcData: CmcIntelligencePayload | null,
    forceImmediate = false
  ): void {
    if (!forceImmediate && !this.isVoiceModeEnabled()) return;
    if (!forceImmediate && this.seenEventIds.has(item.id)) return;
    this.recordSeenEventId(item.id);

    const mf = buildMetaFactsContext(item.symbol, cmcData);
    mf.matchingHeadline = item.title;
    mf.matchingCommunitySummary = item.summary;

    const eventType = item.provider === 'YAHOO_FINANCE' ? 'YAHOO_NEWS' : 'MSN_NEWS';

    this.pushQueueItem({
      req: {
        eventId: forceImmediate ? `${item.id}-MANUAL-${Date.now()}` : item.id,
        category: 'HEADLINE',
        eventType,
        symbol: item.symbol,
        provider: item.sourceLabel,
        headline: item.title,
        detail: item.summary,
        severity: item.sentiment,
        metaFacts: mf,
      },
      clipCategory: 'CMC_HEADLINE',
      sourceLabel: item.sourceLabel,
      forceImmediate,
    });
  }

  public enqueuePionexTicker(
    ticker: PionexMarketTicker,
    cmcData: CmcIntelligencePayload | null,
    forceImmediate = false
  ): void {
    const id = `PNX-${ticker.symbol}-${ticker.signalTag}`;
    if (!forceImmediate && !this.isVoiceModeEnabled()) return;
    if (!forceImmediate && this.seenEventIds.has(id)) return;
    this.recordSeenEventId(id);

    this.pushQueueItem({
      req: {
        eventId: forceImmediate ? `${id}-MANUAL-${Date.now()}` : id,
        category: 'CHRONICLE',
        eventType: 'PIONEX_SCAN',
        symbol: ticker.canonicalSymbol,
        provider: 'PIONEX',
        headline: `Pionex ${ticker.marketType} ${ticker.canonicalSymbol}: ${ticker.signalTag !== 'NORMAL' ? ticker.signalTag : 'Live Update'} (${ticker.change24hPct >= 0 ? '+' : ''}${ticker.change24hPct.toFixed(2)}%)`,
        detail: `24h Volumen $${Math.round(ticker.amount24hUsd).toLocaleString('en-US')} · RVOL ${ticker.rvolScore.toFixed(2)}x · Range ${ticker.rangePct.toFixed(1)}%`,
        price: ticker.price,
        rvol: ticker.rvolScore,
        changePct: ticker.change24hPct,
        severity:
          ticker.change24hPct > 0.5
            ? 'BULLISH'
            : ticker.change24hPct < -0.5
            ? 'BEARISH'
            : 'NEUTRAL',
        metaFacts: buildMetaFactsContext(ticker.canonicalSymbol, cmcData),
      },
      clipCategory: 'RVOL_SPIKE',
      sourceLabel: `PIONEX ${ticker.marketType}`,
      forceImmediate,
    });
  }

  public announceCmcMarketPulse(
    cmcData: CmcIntelligencePayload | null,
    activeSymbol = 'BTC/USD'
  ): void {
    const topAsset = cmcData?.rankedAssets?.[0];
    const targetSym = topAsset ? `${topAsset.symbol}/USD` : activeSymbol;
    const fg = cmcData?.globalMetrics.fearAndGreedIndex ?? 50;
    const fgLabel = cmcData?.globalMetrics.fearAndGreedLabel ?? 'NEUTRAL';
    const btcDom = cmcData?.globalMetrics.btcDominancePct ?? 55;

    this.pushQueueItem({
      req: {
        eventId: `PULSE-${Date.now()}`,
        category: 'MARKET_PULSE',
        eventType: 'MARKET_PULSE',
        symbol: targetSym,
        provider: 'CMC INTELLIGENCE & DEX',
        headline: `Live Markt-Briefing: Fear & Greed bei ${fg} (${fgLabel}), BTC-Dominanz ${btcDom.toFixed(1)}%`,
        detail: `Aktuelle Headlines, Community-Votings und DEX On-Chain Liquiditätsdaten im Überblick`,
        price: topAsset?.price,
        changePct: topAsset?.change24hPct,
        severity: fg >= 55 ? 'BULLISH' : fg <= 40 ? 'BEARISH' : 'NEUTRAL',
        metaFacts: buildMetaFactsContext(targetSym, cmcData),
      },
      clipCategory: 'BROADCAST_INTRO',
      sourceLabel: 'CMC LIVE DESK',
      forceImmediate: true,
    });
  }

  public triggerTestBroadcast(cmcData: CmcIntelligencePayload | null): void {
    this.announceCmcMarketPulse(cmcData, 'BTC/USD');
  }

  public announcePropFirmBriefing(
    firmName: string,
    challengeName: string,
    passPct: number,
    optimalRiskPct: number,
    expectedEvUsd: number
  ): void {
    const text = `Prop Firm Check für ${firmName} ${challengeName}: Die Bestehens-Wahrscheinlichkeit liegt bei ${passPct.toFixed(1)} Prozent. Optimales Risiko pro Trade liegt bei ${optimalRiskPct.toFixed(2)} Prozent mit einem erwarteten Netto-Wert von ${expectedEvUsd >= 0 ? 'plus' : 'minus'} ${Math.abs(Math.round(expectedEvUsd))} Dollar.`;
    this.speakDirectSentence(text, `PROP FIRM · ${firmName}`);
  }

  public announceKeyTakeawayReport(report: KeyTakeawayReport, forceImmediate = true): void {
    if (!report || !report.spokenAnnouncement) return;
    if (isBlockedPaperOrBacktestEvent(report.spokenAnnouncement)) return;
    const topRec = report.recommendations[0];
    const targetSym = topRec?.symbol || report.topMoversSummary[0]?.symbol || 'BTC/USD';
    const metaSummary = `30m Forecast: ${report.forecastBias} (${report.marketRegime}) · 5 Setups · ${report.keyHeadlines.length} Headlines`;

    this.pushQueueItem({
      req: {
        eventId: `${report.id}-${Date.now()}`,
        category: 'MARKET_PULSE',
        eventType: 'MARKET_PULSE',
        symbol: targetSym,
        provider: 'KEY TAKEAWAY 30M',
        headline: `30-Min Key Takeaway (${report.forecastBias}) · ${report.recommendations.length} Trade-Setups`,
        detail: report.forecast30mSummary,
        severity:
          report.forecastBias === 'BULLISH'
            ? 'BULLISH'
            : report.forecastBias === 'BEARISH'
            ? 'BEARISH'
            : 'NEUTRAL',
      },
      clipCategory: 'BROADCAST_INTRO',
      sourceLabel: '30-MIN KEY TAKEAWAY',
      forceImmediate,
      pregeneratedText: report.spokenAnnouncement,
      pregeneratedMetaSummary: metaSummary,
      pregeneratedBy: report.generatedBy === 'gemini' ? 'gemini' : 'template',
    });
  }

  public announceLiveChatQa(
    msg: StudioChatMessage,
    forceImmediate = true,
    resolvedSymbol?: string
  ): void {
    if (!msg || !msg.answerText) return;
    if (isBlockedPaperOrBacktestEvent(`${msg.text} ${msg.answerText}`)) return;
    const spoken = `Zuschauerfrage von ${msg.author} im ${
      msg.source === 'YOUTUBE' ? 'YouTube Chat' : 'Studio Chat'
    }: ${msg.text} — Studio-Antwort: ${msg.answerText}`;
    const combinedUpper = `${msg.answerText} ${msg.text}`.toUpperCase();
    const pairMatch = combinedUpper.match(/\b([A-Z0-9]{2,10}(?:\/(?:USD|USDT|EUR|USDC|SOL|ETH|WETH|BNB)|USDT\.P|USDT))\b/);
    const qaSymbol =
      resolvedSymbol?.trim() ||
      pairMatch?.[1] ||
      'LIVE Q&A';

    this.pushQueueItem({
      req: {
        eventId: `QA-${msg.id}-${Date.now()}`,
        category: 'MARKET_PULSE',
        eventType: 'MARKET_PULSE',
        symbol: qaSymbol,
        provider: msg.source === 'YOUTUBE' ? 'YOUTUBE LIVE CHAT' : 'STUDIO CHAT',
        headline: `${msg.author}: ${msg.text.slice(0, 120)}`,
        detail: msg.answerText,
        severity: 'NEUTRAL',
      },
      clipCategory: 'CMC_HEADLINE',
      sourceLabel: `LIVE CHAT · ${msg.author}`,
      forceImmediate,
      pregeneratedText: spoken.slice(0, 760),
      pregeneratedMetaSummary: `Viewer Q&A (${msg.source}) · ${msg.author}`,
      pregeneratedBy: msg.answeredBy === 'gemini' ? 'gemini' : 'template',
    });
  }

  public speakDirectSentence(
    sentence: string,
    label = 'SPRACHBEFEHL',
    symbolOverride?: string,
    voiceOverride?: {
      googleVoice?: string;
      googleStyle?: string;
      speechPitch?: number;
      speechRate?: number;
    }
  ): void {
    const clean = sentence.trim();
    if (!clean || isBlockedPaperOrBacktestEvent(clean)) return;
    const now = Date.now();
    const item: CommentaryBroadcastItem = {
      id: `DIRECT-${now}`,
      eventId: `DIRECT-${now}`,
      timestamp: now,
      timeFormatted: new Date(now).toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      symbol: symbolOverride?.trim() || 'DESK',
      category: 'MARKET_PULSE',
      eventType: 'CUSTOM_SPEAK',
      sourceLabel: label,
      headline: label,
      spokenText: clean,
      metaFactSummary: voiceOverride?.googleVoice
        ? `Persona Voice · ${voiceOverride.googleVoice}`
        : 'Live Studio Moderation',
      generatedBy: 'template',
      status: 'SPEAKING',
    };
    this.stopCurrentSpeechOnly();
    this.currentItem = item;
    this.emitState();
    this.speakUtterance(clean, voiceOverride).finally(() => {
      item.status = 'DONE';
      this.archiveItem(item);
      this.currentItem = null;
      this.emitState();
    });
  }

  public speakAgentPersonaVote(vote: AgentVote, symbol: string): void {
    const text = `${vote.agentName}: ${vote.thesis}`;
    this.speakDirectSentence(text, `${vote.agentName} · ${vote.stance}`, symbol, {
      googleVoice: vote.googleVoice,
      googleStyle: vote.speechStyle,
      speechPitch: vote.voicePitch,
      speechRate: vote.voiceRate,
    });
  }

  public announceAgentConvergenceDebate(
    decision: AgentConvergenceDecision,
    includeIndividualVoices = true
  ): void {
    if (!decision) return;

    // Acoustic mapping: map convergence outcome to distinct Web Audio chime cue
    if (decision.executionRecord?.status === 'EXECUTED') {
      arcadeSoundEngine.play('ORDER_FILL', { force: true });
    } else if (decision.riskCorsetVetoed) {
      arcadeSoundEngine.play('STOP_LOSS', { force: true });
    } else if (decision.consensusDirection !== 'WAIT') {
      arcadeSoundEngine.play('TAKE_PROFIT', { force: true });
    } else {
      arcadeSoundEngine.play('SCREENER_ALERT', { force: true });
    }

    // Queue headline convergence summary first, followed by top distinct persona voices
    const sym = decision.context.symbol;
    const keyVoices = includeIndividualVoices
      ? [
          decision.votes.find((v) => v.agentId === 'TREND_FOLLOWER'),
          decision.votes.find((v) => v.agentId === 'SKEPTIC'),
          decision.votes.find((v) => v.agentId === 'STRATEGIST'),
        ].filter((v): v is AgentVote => Boolean(v))
      : [];

    // Since forceImmediate unshifts to front, enqueue in reverse order so playback is chronological
    for (let i = keyVoices.length - 1; i >= 0; i--) {
      const v = keyVoices[i];
      this.pushQueueItem({
        req: {
          eventId: `${decision.id}-${v.agentId}`,
          category: 'MARKET_PULSE',
          eventType: 'AGENT_PERSONA',
          symbol: sym,
          provider: `${v.agentName} (${v.googleVoice})`,
          headline: `${v.agentName}: ${v.stance} (${v.confidence}%)`,
          detail: v.riskNote,
          severity: v.stance === 'LONG' ? 'BULLISH' : v.stance === 'SHORT' || v.stance === 'VETO' ? 'BEARISH' : 'NEUTRAL',
        },
        clipCategory: 'CMC_HEADLINE',
        sourceLabel: `${v.agentName} · ${v.googleVoice}`,
        forceImmediate: true,
        pregeneratedText: `${v.agentName} sagt: ${v.thesis}`,
        pregeneratedMetaSummary: `${v.group === 'RISK_CORSET' ? 'Risiko-Korsett' : 'Adaptiv'} · ${v.stance} (${v.confidence}%) · Stimme: ${v.googleVoice}`,
        pregeneratedBy: v.generatedBy === 'gemini' ? 'gemini' : 'template',
        voiceOverride: {
          googleVoice: v.googleVoice,
          googleStyle: v.speechStyle,
          speechPitch: v.voicePitch,
          speechRate: v.voiceRate,
        },
      });
    }

    this.pushQueueItem({
      req: {
        eventId: `${decision.id}-SUMMARY`,
        category: 'MARKET_PULSE',
        eventType: 'AGENT_CONVERGENCE',
        symbol: sym,
        provider: '5-AGENTEN KONVERGENZ',
        headline: `${sym} Konvergenz ${decision.convergencePct}% · ${decision.consensusDirection}`,
        detail: decision.vetoReason || decision.context.macroHeadline,
        severity:
          decision.consensusDirection === 'LONG'
            ? 'BULLISH'
            : decision.consensusDirection === 'SHORT' || decision.riskCorsetVetoed
            ? 'BEARISH'
            : 'NEUTRAL',
      },
      clipCategory: 'BROADCAST_INTRO',
      sourceLabel: '5-AGENTEN KONVERGENZ',
      forceImmediate: true,
      pregeneratedText: decision.spokenSummary,
      pregeneratedMetaSummary: `${decision.convergencePct}% Konvergenz · ${decision.riskCorsetVetoed ? 'VETO' : decision.consensusDirection} · ~${decision.context.estTokens} Tok`,
      pregeneratedBy: 'gemini',
    });
  }

  private pushQueueItem(item: {
    req: CommentaryGenerateRequest;
    clipCategory: TeachableEventClipCategory;
    sourceLabel: string;
    forceImmediate?: boolean;
    pregeneratedText?: string;
    pregeneratedMetaSummary?: string;
    pregeneratedBy?: 'gemini' | 'template';
    voiceOverride?: {
      googleVoice?: string;
      googleStyle?: string;
      speechPitch?: number;
      speechRate?: number;
    };
  }): void {
    if (item.forceImmediate) {
      // Prioritize at front of queue
      this.queue.unshift(item);
    } else {
      this.queue.push(item);
    }

    if (this.queue.length > MAX_QUEUE_LENGTH) {
      this.queue.length = MAX_QUEUE_LENGTH;
    }

    this.emitState();
    this.scheduleNext(Boolean(item.forceImmediate));
  }

  private scheduleNext(immediate = false): void {
    if (this.isProcessing || this.isPaused) return;
    if (this.queue.length === 0) return;

    if (this.broadcastTimer) {
      window.clearTimeout(this.broadcastTimer);
      this.broadcastTimer = null;
    }

    const elapsed = Date.now() - this.lastBroadcastAt;
    const delay = immediate || elapsed >= AUTO_SPEAK_COOLDOWN_MS
      ? 50
      : AUTO_SPEAK_COOLDOWN_MS - elapsed;

    this.broadcastTimer = window.setTimeout(() => {
      this.broadcastTimer = null;
      void this.processNextInQueue();
    }, delay);
  }

  private async processNextInQueue(): Promise<void> {
    if (this.isProcessing || this.isPaused) return;
    const next = this.queue.shift();
    if (!next) return;

    this.isProcessing = true;
    this.activeUtteranceCancel = false;
    this.lastError = null;

    const now = Date.now();
    const broadcastItem: CommentaryBroadcastItem = {
      id: `BR-${now}-${Math.floor(Math.random() * 1000)}`,
      eventId: next.req.eventId,
      timestamp: now,
      timeFormatted: new Date(now).toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      symbol: next.req.symbol,
      category: next.req.category,
      eventType: next.req.eventType || next.clipCategory,
      sourceLabel: next.sourceLabel,
      headline: next.req.headline,
      spokenText: 'Formuliere Live-Einordnung…',
      metaFactSummary: '',
      generatedBy: 'gemini',
      status: 'GENERATING',
    };

    this.currentItem = broadcastItem;
    this.emitState();

    try {
      const audioPrefs = arcadeSoundEngine.getPreferences();
      const teachData = loadVoiceTeachData();
      const clipMap = new Map<TeachableEventClipCategory, CustomEventAudioClipMeta>(
        teachData.clips.map((c) => [c.eventType, c])
      );

      // Optional session intro clip once on first broadcast
      if (!this.introPlayedThisSession) {
        this.introPlayedThisSession = true;
        const introMeta = clipMap.get('BROADCAST_INTRO');
        if (introMeta?.enabled && introMeta.hasAudio && next.clipCategory !== 'BROADCAST_INTRO') {
          arcadeSoundEngine.setVoiceSpeaking(true);
          voiceCommandListener.setSuppressedForPlayback(true);
          await playCustomEventClipBlob('BROADCAST_INTRO', audioPrefs.volume);
        }
      }

      const matchingClip = clipMap.get(next.clipCategory);
      const hasReplaceClip =
        Boolean(matchingClip?.enabled && matchingClip?.hasAudio) &&
        matchingClip?.playbackMode === 'REPLACE_VOICE';

      if (hasReplaceClip && matchingClip) {
        broadcastItem.spokenText = `[Eigener Audio-Clip: ${matchingClip.label}] — ${next.req.headline}`;
        broadcastItem.generatedBy = 'custom_clip';
        broadcastItem.status = 'SPEAKING';
        this.lastTtsProviderUsed = 'CLIP';
        this.emitState();

        arcadeSoundEngine.setVoiceSpeaking(true);
        voiceCommandListener.setSuppressedForPlayback(true);
        this.startBrowserSpeechVuLoop('CLIP');
        await playCustomEventClipBlob(next.clipCategory, audioPrefs.volume);
        this.stopVuLoop();
      } else {
        // Generate German Anchor Script via Server (/api/commentary/generate) unless pre-generated (30m Report / Live Chat Q&A)
        const generated = next.pregeneratedText
          ? {
              eventId: next.req.eventId,
              spokenText: next.pregeneratedText,
              metaFactSummary: next.pregeneratedMetaSummary || next.sourceLabel,
              generatedBy: next.pregeneratedBy || ('gemini' as const),
            }
          : await generateBroadcastCommentary(next.req);
        if (this.activeUtteranceCancel || this.isPaused) {
          broadcastItem.status = 'SKIPPED';
          this.archiveItem(broadcastItem);
          this.finishCycle();
          return;
        }

        broadcastItem.spokenText = generated.spokenText;
        broadcastItem.metaFactSummary = generated.metaFactSummary;
        broadcastItem.generatedBy = generated.generatedBy;
        broadcastItem.status = 'SPEAKING';
        this.emitState();

        arcadeSoundEngine.setVoiceSpeaking(true);
        voiceCommandListener.setSuppressedForPlayback(true);

        // If user recorded an Intro Sting for this event category, play it before speaking!
        if (matchingClip?.enabled && matchingClip?.hasAudio) {
          this.startBrowserSpeechVuLoop('CLIP');
          await playCustomEventClipBlob(next.clipCategory, audioPrefs.volume);
          this.stopVuLoop();
        }

        if (!this.activeUtteranceCancel && !this.isPaused) {
          await this.speakUtterance(generated.spokenText, next.voiceOverride);
        }
      }

      broadcastItem.status = this.activeUtteranceCancel ? 'SKIPPED' : 'DONE';
      this.archiveItem(broadcastItem);
      this.lastBroadcastAt = Date.now();
    } catch (err: any) {
      this.lastError = err?.message || 'Voice-Kommentator Fehler';
      broadcastItem.spokenText = next.req.headline;
      broadcastItem.status = 'DONE';
      this.archiveItem(broadcastItem);
    } finally {
      this.finishCycle();
    }
  }

  private finishCycle(): void {
    this.stopVuLoop();
    arcadeSoundEngine.setVoiceSpeaking(false);
    voiceCommandListener.setSuppressedForPlayback(false);
    this.currentItem = null;
    this.isProcessing = false;
    this.activeUtteranceCancel = false;
    this.emitState();
    if (!this.isPaused && this.queue.length > 0) {
      this.scheduleNext(false);
    }
  }

  private archiveItem(item: CommentaryBroadcastItem): void {
    this.history = [item, ...this.history].slice(0, MAX_HISTORY_LENGTH);
  }

  private recordSeenEventId(id: string): void {
    if (this.seenEventIds.has(id)) {
      this.seenEventIds.delete(id);
    }
    this.seenEventIds.add(id);
    while (this.seenEventIds.size > 250) {
      const oldest = this.seenEventIds.values().next().value;
      if (!oldest) break;
      this.seenEventIds.delete(oldest);
    }
  }

  private async playAudioBlobWithVu(
    blob: Blob,
    volume: number,
    vuSource: 'GOOGLE_NATURAL' | 'QWENTTS' = 'GOOGLE_NATURAL'
  ): Promise<void> {
    const objectUrl = URL.createObjectURL(blob);
    return new Promise((resolve) => {
      const audio = new Audio(objectUrl);
      audio.volume = Math.max(0.05, Math.min(1, volume));
      let rafTimer: number | null = null;
      let safetyTimer: number | null = null;
      let mediaSource: MediaElementAudioSourceNode | null = null;
      let analyserNode: AnalyserNode | null = null;
      let settled = false;

      const cleanup = () => {
        if (settled) return;
        settled = true;
        if (rafTimer !== null) {
          window.clearInterval(rafTimer);
          rafTimer = null;
        }
        if (safetyTimer !== null) {
          window.clearTimeout(safetyTimer);
          safetyTimer = null;
        }
        this.activeAudioStopper = null;
        this.stopVuLoop();
        try {
          mediaSource?.disconnect();
          analyserNode?.disconnect();
        } catch {
          // ignore disconnect errors
        }
        mediaSource = null;
        analyserNode = null;
        try {
          audio.onended = null;
          audio.onerror = null;
          audio.pause();
          audio.removeAttribute('src');
          audio.load();
        } catch {
          // ignore
        }
        URL.revokeObjectURL(objectUrl);
        resolve();
      };

      this.activeAudioStopper = cleanup;

      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          if (!this.ttsAudioCtx) {
            this.ttsAudioCtx = new AudioCtx();
          }
          if (this.ttsAudioCtx.state === 'suspended') {
            void this.ttsAudioCtx.resume();
          }
          mediaSource = this.ttsAudioCtx.createMediaElementSource(audio);
          analyserNode = this.ttsAudioCtx.createAnalyser();
          analyserNode.fftSize = 256;
          mediaSource.connect(analyserNode);
          analyserNode.connect(this.ttsAudioCtx.destination);
          const buf = new Uint8Array(analyserNode.frequencyBinCount);
          const activeAnalyser = analyserNode;
          rafTimer = window.setInterval(() => {
            activeAnalyser.getByteTimeDomainData(buf);
            let sumSq = 0;
            for (let i = 0; i < buf.length; i++) {
              const v = (buf[i] - 128) / 128;
              sumSq += v * v;
            }
            const rms = Math.min(1, Math.sqrt(sumSq / buf.length) * 3.2);
            const peak = Math.max(rms, this.vuReading.peak * 0.92);
            this.emitVu({
              left: rms,
              right: Math.min(1, rms * 0.96),
              peak,
              activeSource: vuSource,
            });
          }, 40);
        } else {
          this.startBrowserSpeechVuLoop('BROWSER');
        }
      } catch {
        this.startBrowserSpeechVuLoop('BROWSER');
      }

      audio.onended = cleanup;
      audio.onerror = cleanup;
      audio.play().catch(cleanup);
      safetyTimer = window.setTimeout(cleanup, 58000);
    });
  }

  private async speakUtterance(
    text: string,
    voiceOverride?: {
      googleVoice?: string;
      googleStyle?: string;
      speechPitch?: number;
      speechRate?: number;
    }
  ): Promise<void> {
    const audioPrefs = arcadeSoundEngine.getPreferences();
    if (!audioPrefs.enabled || audioPrefs.volume <= 0.01) {
      return Promise.resolve();
    }

    const mode = this.prefs.ttsEngineMode || 'AUTO';
    const activeGoogleVoice = voiceOverride?.googleVoice || this.prefs.googleVoice || 'Kore';
    const activeGoogleStyle = voiceOverride?.googleStyle || this.prefs.googleStyle || undefined;

    // 1. Google Natural Voices (@google/genai gemini-3.8-flash-lite-tts) when mode is AUTO or GOOGLE_NATURAL
    const shouldTryGoogle =
      mode === 'GOOGLE_NATURAL' ||
      (mode === 'AUTO' && this.ttsStatus?.googleTts?.available !== false);

    if (shouldTryGoogle) {
      const googleRes = await synthesizeGoogleNaturalVoiceWav(
        text,
        activeGoogleVoice,
        activeGoogleStyle
      );
      if (this.activeUtteranceCancel || this.isPaused) return;
      if (googleRes.blob) {
        this.lastError = null;
        this.lastTtsProviderUsed = 'GOOGLE_NATURAL';
        this.emitState();
        await this.playAudioBlobWithVu(googleRes.blob, audioPrefs.volume, 'GOOGLE_NATURAL');
        return;
      }
      if (googleRes.error) {
        this.lastError = googleRes.error;
        this.emitState();
      }
    }

    // 2. Try qwentts.cpp Backend TTS Bridge when mode is AUTO or QWENTTS
    if (mode === 'QWENTTS' || (mode === 'AUTO' && this.ttsStatus?.reachable)) {
      const wavBlob = await synthesizeQwenTtsWav(
        text,
        this.prefs.qwenSpeaker || 'ryan',
        'German'
      );
      if (this.activeUtteranceCancel || this.isPaused) return;
      if (wavBlob) {
        this.lastError = null;
        this.lastTtsProviderUsed = 'QWENTTS';
        this.emitState();
        await this.playAudioBlobWithVu(wavBlob, audioPrefs.volume, 'QWENTTS');
        return;
      }
    }

    // 3. Seamless Fallback: Browser Web Speech Synthesis (Google / Natural de-DE prioritized)
    this.lastTtsProviderUsed = 'BROWSER';
    this.emitState();

    if (!this.speechSupported) {
      this.startBrowserSpeechVuLoop('BROWSER');
      return new Promise((resolve) => {
        window.setTimeout(() => {
          this.stopVuLoop();
          resolve();
        }, Math.min(4500, Math.max(1500, text.length * 45)));
      });
    }

    return new Promise((resolve) => {
      try {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = 'de-DE';
        utter.rate = voiceOverride?.speechRate ?? this.prefs.speechRate;
        utter.pitch = voiceOverride?.speechPitch ?? this.prefs.speechPitch;
        utter.volume = Math.max(0.05, Math.min(1, audioPrefs.volume));

        if (this.prefs.voiceName) {
          const match = this.availableVoices.find((v) => v.name === this.prefs.voiceName);
          if (match) utter.voice = match;
        }

        let settled = false;
        let safetyTimer: number | null = null;
        const done = () => {
          if (settled) return;
          settled = true;
          if (safetyTimer !== null) {
            window.clearTimeout(safetyTimer);
            safetyTimer = null;
          }
          utter.onboundary = null;
          utter.onend = null;
          utter.onerror = null;
          this.stopVuLoop();
          resolve();
        };

        utter.onboundary = () => {
          this.speechEnvelopeEnergy = Math.min(0.95, this.speechEnvelopeEnergy + 0.35);
        };
        utter.onend = done;
        utter.onerror = done;

        this.startBrowserSpeechVuLoop('BROWSER');
        window.speechSynthesis.speak(utter);
        // Safety ceiling for Chromium speechSynthesis stall bug (accommodates 30m briefings)
        safetyTimer = window.setTimeout(done, 55000);
      } catch {
        this.stopVuLoop();
        resolve();
      }
    });
  }

  private stopCurrentSpeechOnly(): void {
    this.activeUtteranceCancel = true;
    if (this.activeAudioStopper) {
      this.activeAudioStopper();
      this.activeAudioStopper = null;
    }
    if (this.speechSupported) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
    this.stopVuLoop();
    arcadeSoundEngine.setVoiceSpeaking(false);
    voiceCommandListener.setSuppressedForPlayback(false);
  }

  public skipCurrent(): void {
    this.stopCurrentSpeechOnly();
    if (this.currentItem) {
      this.currentItem.status = 'SKIPPED';
    }
    this.emitState();
  }

  public togglePause(): boolean {
    this.isPaused = !this.isPaused;
    if (this.isPaused) {
      this.stopCurrentSpeechOnly();
      if (this.broadcastTimer) {
        window.clearTimeout(this.broadcastTimer);
        this.broadcastTimer = null;
      }
    } else if (this.queue.length > 0) {
      this.scheduleNext(true);
    }
    this.emitState();
    return this.isPaused;
  }

  public replayLast(): void {
    const target =
      this.history.find((h) => h.spokenText && !h.spokenText.startsWith('[')) ||
      this.currentItem;
    if (!target) return;
    this.speakDirectSentence(target.spokenText, `REPLAY · ${target.symbol}`, target.symbol);
  }

  public seedRecentChronicleContext(events: ChronicleAnomalyEvent[]): void {
    // Seed initial Chronicle items so page load doesn't flood speech queue with historical rows
    events.slice(0, 250).forEach((ev) => this.recordSeenEventId(ev.id));
  }
}

export const voiceCommentatorService = new LiveVoiceCommentatorService();
