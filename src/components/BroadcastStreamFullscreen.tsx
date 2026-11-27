import React, { useEffect, useState } from 'react';
import {
  Minimize2,
  Pause,
  Play,
  SkipForward,
  RotateCcw,
  SlidersHorizontal,
  Globe,
  Radio,
  Volume2,
  TrendingUp,
  Droplets,
  Newspaper,
  Radar,
  ExternalLink,
  Tv,
  Shield,
  Sparkles,
  MessageSquare,
  Bot,
} from 'lucide-react';
import {
  AgentConvergenceDecision,
  AgentConvergenceState,
  AgentVote,
  BacktestResult,
  ChronicleAnomalyEvent,
  CmcIntelligencePayload,
  DataProviderId,
  FinanceNewsPayload,
  KeyTakeawayReport,
  KeyTakeawayTradeRecommendation,
  OHLCVCandle,
  PionexUniversePayload,
  ScreenerScheduleStatus,
  StudioChatMessage,
  StudioLiveChatState,
} from '../types/terminal';
import { OrderbookData } from '../types/trading';
import { TerminalWorkspaceChart } from './TerminalWorkspaceChart';
import { ArcadeAudioControl } from './ArcadeAudioControl';
import { AnalogStudioRack } from './AnalogStudioRack';
import { PropFirmArenaPage } from './PropFirmArenaPage';
import { StudioKeyTakeawayDeck } from './StudioKeyTakeawayDeck';
import { StudioLiveChatPanel } from './StudioLiveChatPanel';
import { AgentConvergencePanel } from './AgentConvergencePanel';
import {
  connectYoutubeChat,
  disconnectYoutubeChat,
  fetchKeyTakeawayState,
  fetchStudioChatState,
  generateKeyTakeawayNow,
  postStudioChatMessage,
  replyStudioChatQuestion,
  toggleStudioAutoAnswer,
} from '../services/terminalClient';
import {
  voiceCommentatorService,
  VoiceCommentatorSnapshot,
} from '../services/voiceCommentatorService';
import {
  voiceCommandListener,
  VoiceListenerSnapshot,
} from '../services/voiceCommandListener';

interface BroadcastStreamFullscreenProps {
  isOpen: boolean;
  onExit: () => void;
  symbol: string;
  timeframe: string;
  provider: DataProviderId;
  candles: OHLCVCandle[];
  fastEmaPeriod: number;
  slowEmaPeriod: number;
  liveOrderbook: OrderbookData | null;
  screenerStatus: ScreenerScheduleStatus | null;
  cmcData: CmcIntelligencePayload | null;
  newsData?: FinanceNewsPayload | null;
  pionexData?: PionexUniversePayload | null;
  backtestResult?: BacktestResult | null;
  voiceSnap: VoiceCommentatorSnapshot;
  listenerSnap: VoiceListenerSnapshot;
  onSelectSymbol: (symbol: string) => void;
  onOpenTeachModal: () => void;
  agentConvergenceState?: AgentConvergenceState | null;
  isEvaluatingConvergence?: boolean;
  convergenceError?: string | null;
  onEvaluateConvergenceNow?: () => void;
}

type StreamPage = 'STUDIO' | 'PROP_FIRM';
type StudioLayoutMode = 'FULL' | 'FOCUS' | 'SPLIT';
type DeckTab = 'KEY_TAKEAWAY' | 'AGENTS' | 'HEADLINES' | 'PIONEX' | 'DEX' | 'RANKED';
type RightDeskTab = 'CHRONICLE' | 'LIVE_CHAT';

const TAKEAWAY_INTERVAL_SEC = 30 * 60;

function formatUsdCompact(val: number): string {
  if (!Number.isFinite(val) || val <= 0) return '$0';
  if (val >= 1e12) return `$${(val / 1e12).toFixed(2)}T`;
  if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
  if (val >= 1e3) return `$${(val / 1e3).toFixed(1)}K`;
  return `$${val.toFixed(2)}`;
}

export const BroadcastStreamFullscreen: React.FC<BroadcastStreamFullscreenProps> = ({
  isOpen,
  onExit,
  symbol,
  timeframe,
  provider,
  candles,
  fastEmaPeriod,
  slowEmaPeriod,
  liveOrderbook,
  screenerStatus,
  cmcData,
  newsData,
  pionexData,
  backtestResult = null,
  voiceSnap,
  listenerSnap,
  onSelectSymbol,
  onOpenTeachModal,
  agentConvergenceState = null,
  isEvaluatingConvergence = false,
  convergenceError = null,
  onEvaluateConvergenceNow,
}) => {
  const [streamPage, setStreamPage] = useState<StreamPage>('STUDIO');
  const [studioLayout, setStudioLayout] = useState<StudioLayoutMode>('FULL');
  const [deckTab, setDeckTab] = useState<DeckTab>('KEY_TAKEAWAY');
  const [rightDeskTab, setRightDeskTab] = useState<RightDeskTab>('CHRONICLE');
  const [tickerPaused, setTickerPaused] = useState<boolean>(false);
  const [autoSyncChartToAnnouncement, setAutoSyncChartToAnnouncement] = useState<boolean>(true);

  // 30-Minute Key Takeaway Report & Scheduler State
  const [keyTakeawayReport, setKeyTakeawayReport] = useState<KeyTakeawayReport | null>(null);
  const [isGeneratingTakeaway, setIsGeneratingTakeaway] = useState<boolean>(false);
  const [takeawayError, setTakeawayError] = useState<string | null>(null);
  const [autoEvery30m, setAutoEvery30m] = useState<boolean>(true);
  const [nextTakeawayAt, setNextTakeawayAt] = useState<number>(() => Date.now() + TAKEAWAY_INTERVAL_SEC * 1000);
  const [countdownSec, setCountdownSec] = useState<number>(TAKEAWAY_INTERVAL_SEC);
  const takeawayInflightRef = React.useRef<boolean>(false);

  // Live Chat Reader & Q&A Responder State
  const [chatState, setChatState] = useState<StudioLiveChatState>({
    youtubeConnected: false,
    youtubeVideoId: null,
    youtubeTitle: null,
    youtubeMode: 'DISCONNECTED',
    lastPollAt: null,
    pollError: null,
    autoAnswerQuestions: true,
    messages: [],
  });
  const [isChatPolling, setIsChatPolling] = useState<boolean>(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [replyingIds, setReplyingIds] = useState<Record<string, boolean>>({});
  const handledChatIdsRef = React.useRef<Set<string>>(new Set());
  const lastSyncedAnnouncementIdRef = React.useRef<string | null>(null);

  const symbolRef = React.useRef<string>(symbol);
  symbolRef.current = symbol;
  const onSelectSymbolRef = React.useRef(onSelectSymbol);
  onSelectSymbolRef.current = onSelectSymbol;

  // ESC closes livestream fullscreen cleanly
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onExit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onExit]);

  const handleTriggerKeyTakeaway = React.useCallback(async (speakOnAir: boolean) => {
    if (takeawayInflightRef.current) return;
    takeawayInflightRef.current = true;
    setIsGeneratingTakeaway(true);
    setTakeawayError(null);
    try {
      const res = await generateKeyTakeawayNow(symbolRef.current);
      setKeyTakeawayReport(res.report);
      setNextTakeawayAt(res.report.nextScheduledAt || Date.now() + TAKEAWAY_INTERVAL_SEC * 1000);
      if (speakOnAir) {
        voiceCommentatorService.announceKeyTakeawayReport(res.report, true);
      }
    } catch (err: any) {
      setTakeawayError(err?.message || '30-Min Key Takeaway Fehler.');
      setNextTakeawayAt(Date.now() + 60_000);
    } finally {
      takeawayInflightRef.current = false;
      setIsGeneratingTakeaway(false);
    }
  }, []);

  // Hydrate initial Key Takeaway report when Studio opens
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    fetchKeyTakeawayState()
      .then((res) => {
        if (!active) return;
        if (res.latest) {
          setKeyTakeawayReport(res.latest);
          setNextTakeawayAt(
            res.latest.nextScheduledAt > Date.now()
              ? res.latest.nextScheduledAt
              : Date.now() + TAKEAWAY_INTERVAL_SEC * 1000
          );
        } else {
          void handleTriggerKeyTakeaway(false);
        }
      })
      .catch(() => {
        if (active) {
          void handleTriggerKeyTakeaway(false);
        }
      });
    return () => {
      active = false;
    };
  }, [isOpen, handleTriggerKeyTakeaway]);

  // 1-Second countdown tick + automatic 30-min spoken bulletin trigger
  useEffect(() => {
    if (!isOpen || streamPage !== 'STUDIO') return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((nextTakeawayAt - Date.now()) / 1000));
      setCountdownSec(remaining);
      if (autoEvery30m && remaining <= 0 && !takeawayInflightRef.current) {
        void handleTriggerKeyTakeaway(true);
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [isOpen, streamPage, nextTakeawayAt, autoEvery30m, handleTriggerKeyTakeaway]);

  const resolveChartableAnnouncementSymbol = React.useCallback(
    (rawSymbol?: string | null, fallbackText?: string | null): string | null => {
      const nonChartable = new Set([
        '',
        'DESK',
        'LIVE Q&A',
        'GLOBAL',
        'MARKET',
        'MACRO',
        'CRYPTO',
        'NEWS',
        'ALL',
        'PROP FIRM',
      ]);

      const screenerTickers = screenerStatus?.tickers || [];
      const pionexTickers = pionexData?.tickers || [];
      const cmcAssets = cmcData?.rankedAssets || [];

      const matchByBase = (baseRaw: string): string | null => {
        const base = baseRaw
          .trim()
          .toUpperCase()
          .replace(/USDT\.?P?$/i, '')
          .replace(/\/(USD|USDT|EUR|USDC|SOL|ETH|WETH|BNB)$/i, '');
        if (!base || base.length < 2) return null;

        const scr = screenerTickers.find((t) => {
          const tBase = t.symbol.split('/')[0].replace(/USDT\.?P?$/i, '').toUpperCase();
          return tBase === base;
        });
        if (scr) return scr.symbol;

        const pnx = pionexTickers.find((p) => p.baseAsset.toUpperCase() === base);
        if (pnx) return pnx.canonicalSymbol;

        const cmc = cmcAssets.find((a) => a.symbol.toUpperCase() === base);
        if (cmc) return `${base}/USD`;

        if (base === 'NVDA' || base === 'AAPL') return base;
        return null;
      };

      const cleaned = (rawSymbol || '').trim().toUpperCase();
      if (cleaned && !nonChartable.has(cleaned)) {
        const exactScreener = screenerTickers.find((t) => t.symbol.toUpperCase() === cleaned);
        if (exactScreener) return exactScreener.symbol;

        const exactPionex = pionexTickers.find(
          (p) => p.canonicalSymbol.toUpperCase() === cleaned || p.symbol.toUpperCase() === cleaned
        );
        if (exactPionex) return exactPionex.canonicalSymbol;

        if (cleaned.includes('/') || cleaned.endsWith('USDT') || cleaned.endsWith('USDT.P')) {
          return cleaned;
        }
        const matched = matchByBase(cleaned);
        if (matched) return matched;
      }

      if (fallbackText) {
        const upperText = fallbackText.toUpperCase();
        const explicitPair = upperText.match(
          /\b([A-Z0-9]{2,10}(?:\/(?:USD|USDT|EUR|USDC|SOL|ETH|WETH|BNB)|USDT\.P|USDT))\b/
        );
        if (explicitPair?.[1]) {
          return explicitPair[1];
        }
        for (const t of screenerTickers) {
          const base = t.symbol.split('/')[0].replace(/USDT\.?P?$/i, '').toUpperCase();
          if (base.length >= 2 && new RegExp(`\\b${base}\\b`, 'i').test(upperText)) {
            return t.symbol;
          }
        }
        for (const a of cmcAssets.slice(0, 20)) {
          const base = a.symbol.toUpperCase();
          if (base.length >= 2 && new RegExp(`\\b${base}\\b`, 'i').test(upperText)) {
            return matchByBase(base) || `${base}/USD`;
          }
        }
      }

      if (cleaned === 'CRYPTO') return 'BTC/USD';
      return null;
    },
    [screenerStatus?.tickers, pionexData?.tickers, cmcData?.rankedAssets]
  );

  // Auto-switch Studio chart whenever the active announcement changes
  useEffect(() => {
    if (!isOpen || streamPage !== 'STUDIO' || !autoSyncChartToAnnouncement) return;
    const item = voiceSnap.currentItem;
    if (!item) return;
    if (lastSyncedAnnouncementIdRef.current === item.id) return;

    const targetSym = resolveChartableAnnouncementSymbol(
      item.symbol,
      `${item.headline || ''} ${item.spokenText || ''}`
    );
    lastSyncedAnnouncementIdRef.current = item.id;

    if (targetSym && targetSym.toUpperCase() !== symbolRef.current.toUpperCase()) {
      onSelectSymbolRef.current(targetSym);
    }
  }, [
    isOpen,
    streamPage,
    autoSyncChartToAnnouncement,
    voiceSnap.currentItem,
    resolveChartableAnnouncementSymbol,
  ]);

  const handleReplyAndSpeak = React.useCallback(
    async (msg: StudioChatMessage) => {
      handledChatIdsRef.current.add(msg.id);
      setReplyingIds((prev) => ({ ...prev, [msg.id]: true }));
      setChatError(null);
      try {
        const res = await replyStudioChatQuestion(msg.id, symbolRef.current);
        setChatState(res.state);
        const qaSym = resolveChartableAnnouncementSymbol(
          null,
          `${res.message.answerText || ''} ${res.message.text || ''}`
        );
        voiceCommentatorService.announceLiveChatQa(res.message, true, qaSym || undefined);
      } catch (err: any) {
        setChatError(err?.message || 'Chat-Antwort fehlgeschlagen.');
      } finally {
        setReplyingIds((prev) => {
          const next = { ...prev };
          delete next[msg.id];
          return next;
        });
      }
    },
    [resolveChartableAnnouncementSymbol]
  );

  const syncLiveChat = React.useCallback(
    async (forcePoll = false) => {
      setIsChatPolling(true);
      try {
        const nextState = await fetchStudioChatState(forcePoll);
        setChatState(nextState);
        if (nextState.autoAnswerQuestions) {
          const pending = nextState.messages.filter(
            (m) =>
              m.isQuestion &&
              m.status === 'NEW' &&
              !handledChatIdsRef.current.has(m.id)
          );
          if (pending.length > 0) {
            // Answer at most 2 pending questions per poll cycle to keep broadcast smooth
            for (const q of pending.slice(0, 2)) {
              void handleReplyAndSpeak(q);
            }
          }
        }
      } catch {
        // silent poll retry
      } finally {
        setIsChatPolling(false);
      }
    },
    [handleReplyAndSpeak]
  );

  useEffect(() => {
    if (!isOpen || streamPage !== 'STUDIO') return;
    void syncLiveChat(false);
    const intervalMs = chatState.youtubeConnected ? 5000 : 10000;
    const timer = window.setInterval(() => {
      void syncLiveChat(chatState.youtubeConnected);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [isOpen, streamPage, chatState.youtubeConnected, syncLiveChat]);

  const handleConnectYoutube = async (urlOrId: string) => {
    setChatError(null);
    try {
      const next = await connectYoutubeChat(urlOrId);
      setChatState(next);
    } catch (err: any) {
      setChatError(err?.message || 'YouTube Live-Chat Verbindung fehlgeschlagen.');
    }
  };

  const handleDisconnectYoutube = async () => {
    setChatError(null);
    const next = await disconnectYoutubeChat();
    setChatState(next);
  };

  const handleSendStudioMessage = async (author: string, text: string) => {
    setChatError(null);
    try {
      const res = await postStudioChatMessage(author, text);
      setChatState(res.state);
      if (res.message.isQuestion && res.state.autoAnswerQuestions) {
        await handleReplyAndSpeak(res.message);
      }
    } catch (err: any) {
      setChatError(err?.message || 'Chat-Nachricht konnte nicht gesendet werden.');
    }
  };

  const handleToggleAutoAnswer = async (enabled: boolean) => {
    const next = await toggleStudioAutoAnswer(enabled);
    setChatState(next);
  };

  const handleSpeakSingleSetup = (rec: KeyTakeawayTradeRecommendation) => {
    const line = `Trade-Empfehlung Nummer ${rec.rank} für ${rec.symbol}: ${rec.direction}, Entry bei ${rec.entryPrice}, Stop-Loss ${rec.stopLoss}, Ziel ${rec.takeProfit}, Chance-Risiko ${rec.riskRewardRatio}. ${rec.catalyst}`;
    voiceCommentatorService.speakDirectSentence(line, `SETUP #${rec.rank} · ${rec.symbol}`, rec.symbol);
  };

  if (!isOpen) return null;

  const activeOrLast = voiceSnap.currentItem || voiceSnap.history[0] || null;
  const isSpeaking = voiceSnap.status === 'SPEAKING';
  const latestPrice = candles.length > 0 ? candles[candles.length - 1].close : 0;
  const prevPrice = candles.length > 1 ? candles[candles.length - 2].close : latestPrice;
  const barDeltaPct = prevPrice > 0 ? ((latestPrice - prevPrice) / prevPrice) * 100 : 0;

  // Strictly public market Chronicle events (zero backtest/paper items on Page 1)
  const publicChronicle = (screenerStatus?.chronicle || []).filter(
    (ev) => !/paper|backtest|order_fill/i.test(`${ev.eventType} ${ev.headline}`)
  );

  const handleToggleMic = () => {
    if (listenerSnap.isListening) {
      voiceCommandListener.stop();
    } else {
      void voiceCommandListener.start();
    }
  };

  // Unified Ticker Feed for Bottom Vintage TV Börsenstudio Laufband
  const tickerEntries = [
    ...(screenerStatus?.tickers || []).slice(0, 8).map((t) => ({
      id: `scr-${t.symbol}`,
      tag: t.symbol,
      text: `$${t.price >= 100 ? t.price.toFixed(2) : t.price.toFixed(4)} (${
        t.change24hPct >= 0 ? '+' : ''
      }${t.change24hPct.toFixed(2)}%)`,
      isPositive: t.change24hPct >= 0,
      onClick: () => onSelectSymbol(t.symbol),
    })),
    ...(newsData?.items || []).slice(0, 6).map((n) => ({
      id: `nws-${n.id}`,
      tag: n.provider === 'YAHOO_FINANCE' ? 'YAHOO' : 'MSN',
      text: `${n.symbol}: ${n.title}`,
      isPositive: n.sentiment !== 'BEARISH',
      onClick: () => voiceCommentatorService.enqueueFinanceNews(n, cmcData, true),
    })),
    ...(pionexData?.tickers || []).slice(0, 6).map((p) => ({
      id: `pnx-${p.symbol}`,
      tag: `PIONEX ${p.marketType}`,
      text: `${p.canonicalSymbol} ${p.change24hPct >= 0 ? '+' : ''}${p.change24hPct.toFixed(
        2
      )}% · RVOL ${p.rvolScore.toFixed(1)}x`,
      isPositive: p.change24hPct >= 0,
      onClick: () => onSelectSymbol(p.canonicalSymbol),
    })),
  ];

  // Shared Radar Deck (used in FULL bottom and SPLIT left column)
  const renderRadarDeck = () => (
    <div className="flex-1 flex flex-col min-h-0 bg-[#0B0F15]">
      <div className="px-3 bg-[#07090E] border-b border-[#263042] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto">
          <button
            type="button"
            onClick={() => setDeckTab('KEY_TAKEAWAY')}
            className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border-b-2 flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              deckTab === 'KEY_TAKEAWAY'
                ? 'border-[#00E5FF] text-[#00E5FF]'
                : 'border-transparent text-[#8B95A5] hover:text-[#E6EDF3]'
            }`}
          >
            <Sparkles className="w-3 h-3" />
            <span>
              30M KEY TAKEAWAY ({String(Math.floor(countdownSec / 60)).padStart(2, '0')}:
              {String(countdownSec % 60).padStart(2, '0')})
            </span>
          </button>
          <button
            type="button"
            onClick={() => setDeckTab('AGENTS')}
            className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border-b-2 flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              deckTab === 'AGENTS'
                ? 'border-[#00E5FF] text-[#00E5FF]'
                : 'border-transparent text-[#8B95A5] hover:text-[#E6EDF3]'
            }`}
          >
            <Bot className="w-3 h-3" />
            <span>
              AGENTEN-KONVERGENZ
              {agentConvergenceState?.latest
                ? ` (${agentConvergenceState.latest.convergencePct}%)`
                : ''}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setDeckTab('HEADLINES')}
            className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border-b-2 flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              deckTab === 'HEADLINES'
                ? 'border-[#F59E0B] text-[#F59E0B]'
                : 'border-transparent text-[#8B95A5] hover:text-[#E6EDF3]'
            }`}
          >
            <Newspaper className="w-3 h-3" />
            <span>
              YAHOO · MSN &amp; CMC ({(newsData?.items.length || 0) + (cmcData?.signals.length || 0)})
            </span>
          </button>
          <button
            type="button"
            onClick={() => setDeckTab('PIONEX')}
            className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border-b-2 flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              deckTab === 'PIONEX'
                ? 'border-[#F97316] text-[#F97316]'
                : 'border-transparent text-[#8B95A5] hover:text-[#E6EDF3]'
            }`}
          >
            <Radar className="w-3 h-3" />
            <span>PIONEX USDT ({pionexData?.totalUsdtMarkets || 0})</span>
          </button>
          <button
            type="button"
            onClick={() => setDeckTab('DEX')}
            className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border-b-2 flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              deckTab === 'DEX'
                ? 'border-[#089981] text-[#089981]'
                : 'border-transparent text-[#8B95A5] hover:text-[#E6EDF3]'
            }`}
          >
            <Droplets className="w-3 h-3" />
            <span>DEX ON-CHAIN ({cmcData?.dexPairs.length || 0})</span>
          </button>
          <button
            type="button"
            onClick={() => setDeckTab('RANKED')}
            className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border-b-2 flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              deckTab === 'RANKED'
                ? 'border-[#60A5FA] text-[#60A5FA]'
                : 'border-transparent text-[#8B95A5] hover:text-[#E6EDF3]'
            }`}
          >
            <TrendingUp className="w-3 h-3" />
            <span>CMC RANKED ({cmcData?.rankedAssets.length || 0})</span>
          </button>
        </div>
        <span className="text-[10px] font-mono text-[#566173] hidden lg:inline whitespace-nowrap">
          Klick auf ON AIR startet Studio-Moderation
        </span>
      </div>

      {deckTab === 'KEY_TAKEAWAY' ? (
        <StudioKeyTakeawayDeck
          report={keyTakeawayReport}
          isGenerating={isGeneratingTakeaway}
          autoEvery30m={autoEvery30m}
          countdownSec={countdownSec}
          errorMsg={takeawayError}
          onToggleAuto={() => setAutoEvery30m((v) => !v)}
          onTriggerNow={() => void handleTriggerKeyTakeaway(true)}
          onSpeakCurrent={() => {
            if (keyTakeawayReport) {
              voiceCommentatorService.announceKeyTakeawayReport(keyTakeawayReport, true);
            }
          }}
          onSelectSymbol={onSelectSymbol}
          onSpeakSingleSetup={handleSpeakSingleSetup}
        />
      ) : deckTab === 'AGENTS' ? (
        <AgentConvergencePanel
          mode="STUDIO"
          state={
            agentConvergenceState || {
              latest: null,
              history: [],
              executions: [],
              config: {
                autoExecuteEnabled: true,
                minConvergencePct: 70,
                maxRiskPctPerTrade: 2,
                cooldownSecPerSymbol: 300,
                autoSpeakDebate: true,
              },
              personas: [],
            }
          }
          activeSymbol={symbol}
          isEvaluating={isEvaluatingConvergence}
          errorMsg={convergenceError}
          onEvaluateNow={() => onEvaluateConvergenceNow?.()}
          onSelectSymbol={onSelectSymbol}
          onSpeakDebate={(decision: AgentConvergenceDecision) =>
            voiceCommentatorService.announceAgentConvergenceDebate(decision, true)
          }
          onSpeakVote={(vote: AgentVote, sym: string) =>
            voiceCommentatorService.speakAgentPersonaVote(vote, sym)
          }
        />
      ) : (
        <div className="flex-1 overflow-y-auto p-3">
        {deckTab === 'HEADLINES' && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-2.5">
            {(newsData?.items || []).slice(0, 10).map((news) => (
              <div
                key={news.id}
                className="p-2.5 bg-[#07090E] border border-[#1E2634] flex flex-col justify-between gap-1.5"
              >
                <div className="flex items-center justify-between gap-2 text-[10px] font-mono tabular-nums">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[#8B95A5]">{news.timeFormatted}</span>
                    <span aria-hidden="true">·</span>
                    <span
                      className={`font-bold ${
                        news.provider === 'YAHOO_FINANCE' ? 'text-[#C084FC]' : 'text-[#38BDF8]'
                      }`}
                    >
                      {news.provider === 'YAHOO_FINANCE' ? 'YAHOO FINANCE' : 'MSN FINANCE'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-bold text-[#F59E0B]">{news.symbol}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => voiceCommentatorService.enqueueFinanceNews(news, cmcData, true)}
                      title="Diese News jetzt live kommentieren"
                      className="px-1.5 py-0.5 border border-[#263042] hover:border-[#F59E0B] text-[#F59E0B] flex items-center gap-1"
                    >
                      <Volume2 className="w-2.5 h-2.5" />
                      <span>ON AIR</span>
                    </button>
                    {news.link.startsWith('https://') && (
                      <a
                        href={news.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 border border-[#263042] text-[#8B95A5] hover:text-[#E6EDF3]"
                      >
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                  </div>
                </div>
                <div className="text-xs font-semibold text-[#E6EDF3]">{news.title}</div>
                <p className="text-[11px] text-[#8B95A5] leading-snug">{news.summary}</p>
              </div>
            ))}
            {(cmcData?.signals || []).map((sig) => (
              <div
                key={sig.id}
                className="p-2.5 bg-[#07090E] border border-[#1E2634] flex flex-col justify-between gap-1.5"
              >
                <div className="flex items-center justify-between gap-2 text-[10px] font-mono tabular-nums">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[#8B95A5]">{sig.timeFormatted}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-bold text-[#00E5FF]">{sig.symbol}</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-[#8B95A5] truncate">{sig.category}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => voiceCommentatorService.enqueueCommunitySignal(sig, cmcData, true)}
                    title="Diese Meldung jetzt live kommentieren"
                    className="px-1.5 py-0.5 border border-[#263042] hover:border-[#00E5FF] text-[#00E5FF] flex items-center gap-1 shrink-0"
                  >
                    <Volume2 className="w-2.5 h-2.5" />
                    <span>ON AIR</span>
                  </button>
                </div>
                <div className="text-xs font-semibold text-[#E6EDF3]">{sig.headline}</div>
                <p className="text-[11px] text-[#8B95A5] leading-snug">{sig.summary}</p>
              </div>
            ))}
          </div>
        )}

        {deckTab === 'PIONEX' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse font-mono tabular-nums text-[11px]">
              <thead>
                <tr className="border-b border-[#263042] text-[10px] text-[#8B95A5]">
                  <th className="py-1.5 pr-3">PIONEX USDT</th>
                  <th className="py-1.5 pr-3 text-right">PREIS</th>
                  <th className="py-1.5 pr-3 text-right">24H %</th>
                  <th className="py-1.5 pr-3 text-right">24H VOL $</th>
                  <th className="py-1.5 pr-3 text-right">RVOL</th>
                  <th className="py-1.5 pr-3">SIGNAL</th>
                  <th className="py-1.5 text-right">KOMMENTAR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1E2634]">
                {(pionexData?.tickers || []).slice(0, 60).map((t) => (
                  <tr
                    key={t.symbol}
                    onClick={() => onSelectSymbol(t.canonicalSymbol)}
                    className="hover:bg-[#131924] cursor-pointer"
                  >
                    <td className="py-1.5 pr-3">
                      <span className="font-bold text-[#F97316]">{t.canonicalSymbol}</span>
                      <span className="text-[10px] text-[#8B95A5] ml-2">{t.marketType}</span>
                    </td>
                    <td className="py-1.5 pr-3 text-right text-[#E6EDF3]">
                      ${t.price < 0.01 ? t.price.toFixed(6) : t.price.toFixed(4)}
                    </td>
                    <td
                      className={`py-1.5 pr-3 text-right font-bold ${
                        t.change24hPct >= 0 ? 'text-[#089981]' : 'text-[#F23645]'
                      }`}
                    >
                      {t.change24hPct >= 0 ? '+' : ''}
                      {t.change24hPct.toFixed(2)}%
                    </td>
                    <td className="py-1.5 pr-3 text-right text-[#00E5FF]">
                      {formatUsdCompact(t.amount24hUsd)}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-[#E6EDF3]">
                      {t.rvolScore.toFixed(2)}x
                    </td>
                    <td className="py-1.5 pr-3 text-[10px] text-[#F59E0B]">
                      {t.signalTag !== 'NORMAL' ? t.signalTag : '—'}
                    </td>
                    <td className="py-1.5 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          voiceCommentatorService.enqueuePionexTicker(t, cmcData, true);
                        }}
                        className="px-1.5 py-0.5 border border-[#263042] hover:border-[#F97316] text-[#F97316] text-[9px] inline-flex items-center gap-1"
                      >
                        <Volume2 className="w-2.5 h-2.5" />
                        <span>ON AIR</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {deckTab === 'DEX' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse font-mono tabular-nums text-[11px]">
              <thead>
                <tr className="border-b border-[#263042] text-[10px] text-[#8B95A5]">
                  <th className="py-1.5 pr-3">PAIR / DEX</th>
                  <th className="py-1.5 pr-3 text-right">PREIS</th>
                  <th className="py-1.5 pr-3 text-right">1H %</th>
                  <th className="py-1.5 pr-3 text-right">LIQUIDITÄT</th>
                  <th className="py-1.5 pr-3 text-right">24H VOL</th>
                  <th className="py-1.5 pr-3 text-right">BUYS / SELLS</th>
                  <th className="py-1.5 text-right">KOMMENTAR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1E2634]">
                {(cmcData?.dexPairs || []).map((pair) => {
                  const totalTx = Math.max(1, pair.txns24hBuys + pair.txns24hSells);
                  const buyPct = Math.round((pair.txns24hBuys / totalTx) * 100);
                  return (
                    <tr key={pair.id} className="hover:bg-[#131924]">
                      <td className="py-1.5 pr-3">
                        <span className="font-bold text-[#E6EDF3]">{pair.pairSymbol}</span>
                        <span className="text-[10px] text-[#8B95A5] ml-2">
                          {pair.dexName} · {pair.network}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 text-right text-[#E6EDF3]">
                        ${pair.priceUsd < 0.01 ? pair.priceUsd.toFixed(6) : pair.priceUsd.toFixed(4)}
                      </td>
                      <td
                        className={`py-1.5 pr-3 text-right font-bold ${
                          pair.change1hPct >= 0 ? 'text-[#089981]' : 'text-[#F23645]'
                        }`}
                      >
                        {pair.change1hPct >= 0 ? '+' : ''}
                        {pair.change1hPct.toFixed(2)}%
                      </td>
                      <td className="py-1.5 pr-3 text-right text-[#00E5FF]">
                        {formatUsdCompact(pair.liquidityUsd)}
                      </td>
                      <td className="py-1.5 pr-3 text-right text-[#E6EDF3]">
                        {formatUsdCompact(pair.volume24hUsd)}
                      </td>
                      <td className="py-1.5 pr-3 text-right">
                        <span className="text-[#089981]">{buyPct}%</span>
                        <span className="text-[#566173]"> / </span>
                        <span className="text-[#F23645]">{100 - buyPct}%</span>
                      </td>
                      <td className="py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            voiceCommentatorService.enqueueDexFlowEvent(pair, cmcData, true)
                          }
                          className="px-1.5 py-0.5 border border-[#263042] hover:border-[#089981] text-[#089981] text-[9px] inline-flex items-center gap-1"
                        >
                          <Volume2 className="w-2.5 h-2.5" />
                          <span>ON AIR</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {deckTab === 'RANKED' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse font-mono tabular-nums text-[11px]">
              <thead>
                <tr className="border-b border-[#263042] text-[10px] text-[#8B95A5]">
                  <th className="py-1.5 pr-3">#</th>
                  <th className="py-1.5 pr-3">ASSET</th>
                  <th className="py-1.5 pr-3 text-right">PREIS</th>
                  <th className="py-1.5 pr-3 text-right">24H %</th>
                  <th className="py-1.5 pr-3 text-right">MCAP</th>
                  <th className="py-1.5 text-right">VOL / MC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1E2634]">
                {(cmcData?.rankedAssets || []).map((asset) => (
                  <tr
                    key={asset.symbol}
                    onClick={() => onSelectSymbol(`${asset.symbol}/USD`)}
                    className="hover:bg-[#131924] cursor-pointer"
                  >
                    <td className="py-1.5 pr-3 text-[#8B95A5]">{asset.cmcRank}</td>
                    <td className="py-1.5 pr-3">
                      <span className="font-bold text-[#00E5FF]">{asset.symbol}</span>
                      <span className="text-[#8B95A5] ml-2 text-[10px]">{asset.name}</span>
                    </td>
                    <td className="py-1.5 pr-3 text-right text-[#E6EDF3]">
                      ${asset.price >= 100 ? asset.price.toFixed(2) : asset.price.toFixed(4)}
                    </td>
                    <td
                      className={`py-1.5 pr-3 text-right font-bold ${
                        asset.change24hPct >= 0 ? 'text-[#089981]' : 'text-[#F23645]'
                      }`}
                    >
                      {asset.change24hPct >= 0 ? '+' : ''}
                      {asset.change24hPct.toFixed(2)}%
                    </td>
                    <td className="py-1.5 pr-3 text-right text-[#E6EDF3]">
                      {formatUsdCompact(asset.marketCapUsd)}
                    </td>
                    <td className="py-1.5 text-right text-[#8B95A5]">
                      {asset.volumeMcRatioPct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </div>
      )}
    </div>
  );

  // Shared Audio Teleprompter + Chronicle Stream
  const renderAudioDeskAndChronicle = (expandedTeleprompter = false) => (
    <div className="flex-1 flex flex-col min-h-0 bg-[#0B0F15]">
      <AnalogStudioRack
        voiceSnap={voiceSnap}
        listenerSnap={listenerSnap}
        tickerPaused={tickerPaused}
        onToggleTickerPaused={() => setTickerPaused((p) => !p)}
        onToggleVoicePaused={() => voiceCommentatorService.togglePause()}
        onToggleMic={handleToggleMic}
      />

      {/* Live Voice-Out Teleprompter */}
      <div className="p-3 bg-[#07090E] border-b border-[#263042] space-y-2.5 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={`px-2 py-0.5 text-[10px] font-mono font-bold border ${
                isSpeaking
                  ? 'border-[#EF4444] bg-[#EF4444]/20 text-[#EF4444]'
                  : voiceSnap.isPaused
                  ? 'border-[#F59E0B] bg-[#F59E0B]/15 text-[#F59E0B]'
                  : 'border-[#089981] bg-[#089981]/15 text-[#089981]'
              }`}
            >
              {isSpeaking
                ? 'ON AIR'
                : voiceSnap.status === 'GENERATING'
                ? 'ANALYSE…'
                : voiceSnap.isPaused
                ? 'PAUSE'
                : 'BEREIT'}
            </span>
            <span className="text-[11px] font-bold tracking-wider uppercase text-[#E6EDF3]">
              STUDIO TELEPROMPTER
            </span>
          </div>

          <span className="text-[10px] font-mono text-[#8B95A5]">
            {voiceSnap.lastTtsProviderUsed === 'GOOGLE_NATURAL'
              ? 'Google Natural HD'
              : voiceSnap.lastTtsProviderUsed === 'QWENTTS'
              ? 'Qwen3-TTS WAV'
              : voiceSnap.lastTtsProviderUsed === 'CLIP'
              ? 'Studio Clip'
              : 'Web Speech DE'}
          </span>
        </div>

        {activeOrLast ? (
          <div className="p-3 bg-[#0C1118] border border-[#263042] space-y-2">
            <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-[#8B95A5]">
              <span>
                {activeOrLast.timeFormatted} ·{' '}
                <strong className="text-[#F59E0B]">{activeOrLast.symbol}</strong> ·{' '}
                {activeOrLast.eventType}
              </span>
              <span>
                {activeOrLast.generatedBy === 'gemini'
                  ? 'Gemini'
                  : activeOrLast.generatedBy === 'custom_clip'
                  ? 'Clip'
                  : 'Anchor'}
              </span>
            </div>
            <p
              className={`leading-relaxed text-[#E6EDF3] font-medium ${
                expandedTeleprompter ? 'text-[17px]' : 'text-[14px]'
              }`}
            >
              {activeOrLast.spokenText}
            </p>
            {activeOrLast.metaFactSummary && (
              <div className="text-[10px] font-mono text-[#8B95A5] pt-1.5 border-t border-[#1E2634]">
                {activeOrLast.metaFactSummary}
              </div>
            )}
          </div>
        ) : (
          <div className="p-3 bg-[#0C1118] border border-[#263042] text-xs text-[#8B95A5]">
            Der Live-Kommentator überträgt automatisch neue Chronicle-Ereignisse, Yahoo/MSN-Schlagzeilen, Pionex-Märkte und DEX-On-Chain-Fakten.
          </div>
        )}

        {/* Stream Transport Buttons */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => voiceCommentatorService.togglePause()}
              className={`px-2.5 py-1 border text-[10px] font-mono font-bold flex items-center gap-1 ${
                voiceSnap.isPaused
                  ? 'border-[#F59E0B] text-[#F59E0B] bg-[#F59E0B]/15'
                  : 'border-[#263042] bg-[#0C1118] text-[#E6EDF3] hover:border-[#F59E0B]'
              }`}
            >
              {voiceSnap.isPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
              <span>{voiceSnap.isPaused ? 'FORTSETZEN' : 'PAUSE'}</span>
            </button>
            <button
              type="button"
              onClick={() => voiceCommentatorService.skipCurrent()}
              className="px-2 py-1 border border-[#263042] bg-[#0C1118] text-[#8B95A5] hover:text-[#E6EDF3] text-[10px] font-mono flex items-center gap-1"
            >
              <SkipForward className="w-3 h-3" />
              <span>SKIP</span>
            </button>
            <button
              type="button"
              onClick={() => voiceCommentatorService.replayLast()}
              className="px-2 py-1 border border-[#263042] bg-[#0C1118] text-[#8B95A5] hover:text-[#E6EDF3] text-[10px] font-mono flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              <span>REPLAY</span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => voiceCommentatorService.announceCmcMarketPulse(cmcData, symbol)}
            className="px-2.5 py-1 border border-[#F59E0B]/60 bg-[#F59E0B]/15 text-[#F59E0B] text-[10px] font-mono font-bold flex items-center gap-1 whitespace-nowrap"
          >
            <Globe className="w-3 h-3" />
            <span>MARKT BRIEFING</span>
          </button>
        </div>

        {listenerSnap.lastMatchedLabel && (
          <div className="text-[10px] font-mono text-[#F59E0B]">
            Befehl erkannt: {listenerSnap.lastMatchedLabel}
          </div>
        )}
      </div>

      {/* Chronicle of Events OR Live Chat Q&A Switcher */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-3 bg-[#07090E] border-b border-[#263042] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setRightDeskTab('CHRONICLE')}
              className={`px-2.5 py-1.5 text-[10px] font-bold tracking-wider uppercase border-b-2 whitespace-nowrap ${
                rightDeskTab === 'CHRONICLE'
                  ? 'border-[#F59E0B] text-[#F59E0B]'
                  : 'border-transparent text-[#8B95A5] hover:text-[#E6EDF3]'
              }`}
            >
              CHRONICLE ({publicChronicle.length})
            </button>
            <button
              type="button"
              onClick={() => setRightDeskTab('LIVE_CHAT')}
              className={`px-2.5 py-1.5 text-[10px] font-bold tracking-wider uppercase border-b-2 flex items-center gap-1.5 whitespace-nowrap ${
                rightDeskTab === 'LIVE_CHAT'
                  ? 'border-[#00E5FF] text-[#00E5FF]'
                  : 'border-transparent text-[#8B95A5] hover:text-[#E6EDF3]'
              }`}
            >
              <MessageSquare className="w-3 h-3" />
              <span>
                LIVE CHAT Q&amp;A ({chatState.messages.length})
              </span>
            </button>
          </div>
          <span className="text-[10px] font-mono text-[#8B95A5]">
            {rightDeskTab === 'LIVE_CHAT'
              ? chatState.youtubeConnected
                ? 'YT LIVE AKTIV'
                : 'STUDIO CHAT'
              : 'LIVE FEED'}
          </span>
        </div>

        {rightDeskTab === 'LIVE_CHAT' ? (
          <StudioLiveChatPanel
            chatState={chatState}
            isPolling={isChatPolling}
            replyingIds={replyingIds}
            errorMsg={chatError}
            onConnectYoutube={handleConnectYoutube}
            onDisconnectYoutube={handleDisconnectYoutube}
            onPollNow={() => syncLiveChat(true)}
            onSendStudioMessage={handleSendStudioMessage}
            onToggleAutoAnswer={handleToggleAutoAnswer}
            onReplyAndSpeak={handleReplyAndSpeak}
            onReplayQa={(msg) => {
              const qaSym = resolveChartableAnnouncementSymbol(
                null,
                `${msg.answerText || ''} ${msg.text || ''}`
              );
              voiceCommentatorService.announceLiveChatQa(msg, true, qaSym || undefined);
            }}
          />
        ) : (
          <div className="flex-1 overflow-y-auto divide-y divide-[#1E2634] font-mono tabular-nums text-[11px]">
            {publicChronicle.map((ev: ChronicleAnomalyEvent) => (
              <div
                key={ev.id}
                onClick={() => onSelectSymbol(ev.symbol)}
                className="px-3 py-2 hover:bg-[#131924] cursor-pointer transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[#8B95A5]">{ev.timeFormatted}</span>
                    <span className="font-bold text-[#F59E0B]">{ev.symbol}</span>
                    <span className="text-[#566173] text-[10px] truncate">{ev.provider}</span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      voiceCommentatorService.enqueueChronicleEvent(ev, cmcData, true);
                    }}
                    title="Event sofort live kommentieren"
                    className="p-1 border border-[#263042] hover:border-[#F59E0B] text-[#8B95A5] hover:text-[#F59E0B] shrink-0"
                  >
                    <Volume2 className="w-3 h-3" />
                  </button>
                </div>
                <div
                  className={`mt-1 leading-snug ${
                    ev.severity === 'BULLISH'
                      ? 'text-[#089981]'
                      : ev.severity === 'BEARISH'
                      ? 'text-[#F23645]'
                      : ev.severity === 'WARNING'
                      ? 'text-[#F59E0B]'
                      : 'text-[#E6EDF3]'
                  }`}
                >
                  {ev.headline}
                </div>
                <div className="text-[10px] text-[#8B95A5] mt-0.5">{ev.detail}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-40 bg-[#07090E] text-[#E6EDF3] flex flex-col overflow-hidden">
      {/* Vintage TV Börsenstudio Regie Header */}
      <header className="px-3 py-1.5 bg-[#0B0F15] border-b border-[#263042] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {/* Vintage On-Air Studio Tally Box */}
          <div
            className={`px-2.5 py-1 border font-mono text-[10px] font-bold tracking-widest flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              isSpeaking
                ? 'border-[#EF4444] bg-[#EF4444]/20 text-[#FCA5A5]'
                : 'border-[#D97706]/50 bg-[#231B0E] text-[#F59E0B]'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>{isSpeaking ? 'ON AIR · STUDIO LIVE' : 'BÖRSENSTUDIO'}</span>
          </div>

          {/* 2-Page Stream Switcher */}
          <div className="flex items-center bg-[#07090E] border border-[#263042] p-0.5 shrink-0">
            <button
              type="button"
              onClick={() => setStreamPage('STUDIO')}
              className={`px-2.5 py-1 text-[10px] font-mono font-bold flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                streamPage === 'STUDIO'
                  ? 'bg-[#F59E0B] text-[#07090E]'
                  : 'text-[#8B95A5] hover:text-[#E6EDF3]'
              }`}
            >
              <Tv className="w-3 h-3" />
              <span>1. TV STUDIO STREAM</span>
            </button>
            <button
              type="button"
              onClick={() => setStreamPage('PROP_FIRM')}
              className={`px-2.5 py-1 text-[10px] font-mono font-bold flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                streamPage === 'PROP_FIRM'
                  ? 'bg-[#00E5FF] text-[#07090E]'
                  : 'text-[#8B95A5] hover:text-[#E6EDF3]'
              }`}
            >
              <Shield className="w-3 h-3" />
              <span>2. PROP FIRM ARENA</span>
            </button>
          </div>

          {/* 3 Studio Layout Presets (only on Page 1) */}
          {streamPage === 'STUDIO' && (
            <div className="hidden lg:flex items-center bg-[#07090E] border border-[#263042] p-0.5 shrink-0">
              <button
                type="button"
                onClick={() => setStudioLayout('FULL')}
                className={`px-2 py-1 text-[10px] font-mono whitespace-nowrap ${
                  studioLayout === 'FULL'
                    ? 'bg-[#1E2634] text-[#F59E0B] font-bold'
                    : 'text-[#8B95A5] hover:text-[#E6EDF3]'
                }`}
              >
                KOMPLETT
              </button>
              <button
                type="button"
                onClick={() => setStudioLayout('FOCUS')}
                className={`px-2 py-1 text-[10px] font-mono whitespace-nowrap ${
                  studioLayout === 'FOCUS'
                    ? 'bg-[#1E2634] text-[#F59E0B] font-bold'
                    : 'text-[#8B95A5] hover:text-[#E6EDF3]'
                }`}
              >
                FOKUS CHART
              </button>
              <button
                type="button"
                onClick={() => setStudioLayout('SPLIT')}
                className={`px-2 py-1 text-[10px] font-mono whitespace-nowrap ${
                  studioLayout === 'SPLIT'
                    ? 'bg-[#1E2634] text-[#F59E0B] font-bold'
                    : 'text-[#8B95A5] hover:text-[#E6EDF3]'
                }`}
              >
                RADAR &amp; AUDIO SPLIT
              </button>
            </div>
          )}

          {/* Live Symbol & Macro Readout */}
          <div className="hidden xl:flex items-center gap-2.5 text-xs font-mono tabular-nums text-[#8B95A5] truncate">
            <span className="text-[#F59E0B] font-bold">{symbol}</span>
            <span className="text-[#E6EDF3]">
              {latestPrice > 0
                ? `$${latestPrice >= 100 ? latestPrice.toFixed(2) : latestPrice.toFixed(4)}`
                : '—'}
            </span>
            <span className={barDeltaPct >= 0 ? 'text-[#089981]' : 'text-[#F23645]'}>
              {barDeltaPct >= 0 ? '+' : ''}
              {barDeltaPct.toFixed(2)}%
            </span>
            {cmcData && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  F&amp;G <strong className="text-[#E6EDF3]">{cmcData.globalMetrics.fearAndGreedIndex}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  BTC <strong className="text-[#F59E0B]">{cmcData.globalMetrics.btcDominancePct.toFixed(1)}%</strong>
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenTeachModal}
            className="px-2.5 py-1 border border-[#089981]/60 bg-[#089981]/15 text-[#089981] text-[10px] font-mono font-bold flex items-center gap-1.5 whitespace-nowrap"
          >
            <SlidersHorizontal className="w-3 h-3" />
            <span>BEFEHLE &amp; CLIPS</span>
          </button>

          <ArcadeAudioControl />

          <button
            type="button"
            onClick={onExit}
            className="px-3 py-1 bg-[#1B2230] hover:bg-[#263042] border border-[#354359] text-[#E6EDF3] text-[10px] font-mono font-bold flex items-center gap-1.5 whitespace-nowrap"
          >
            <Minimize2 className="w-3 h-3" />
            <span>BEENDEN (ESC)</span>
          </button>
        </div>
      </header>

      {/* PAGE 1: ANALOG TV BÖRSENSTUDIO */}
      {streamPage === 'STUDIO' && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {studioLayout === 'SPLIT' ? (
            /* SPLIT VIEW: Left = Pionex/DEX/Yahoo-MSN Radar · Right = Analog Audio & Moderation Studio */
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 min-h-0 overflow-hidden">
              <div className="flex flex-col min-h-0 border-r border-[#263042] overflow-hidden">
                {renderRadarDeck()}
              </div>
              <div className="flex flex-col min-h-0 overflow-hidden">
                {renderAudioDeskAndChronicle(true)}
              </div>
            </div>
          ) : (
            /* FULL OR FOCUS VIEW */
            <div className="flex-1 flex min-h-0 overflow-hidden">
              <div className="flex-1 flex flex-col min-w-0 min-h-0 border-r border-[#263042]">
                {/* Live Watch Ticker Strip */}
                <div className="px-3 py-1 bg-[#090D14] border-b border-[#263042] flex items-center gap-2 overflow-x-auto shrink-0">
                  <button
                    type="button"
                    onClick={() => setAutoSyncChartToAnnouncement((v) => !v)}
                    title="Chart automatisch auf das Symbol der aktuellen Ansage wechseln"
                    className={`px-2 py-0.5 text-[10px] font-mono font-bold border whitespace-nowrap shrink-0 transition-colors ${
                      autoSyncChartToAnnouncement
                        ? 'border-[#00E5FF] bg-[#00E5FF]/15 text-[#00E5FF]'
                        : 'border-[#263042] bg-[#0C1017] text-[#8B95A5] hover:text-[#E6EDF3]'
                    }`}
                  >
                    AUTO-CHART: {autoSyncChartToAnnouncement ? 'AN' : 'AUS'}
                  </button>
                  <span className="text-[10px] font-mono text-[#D97706] uppercase font-bold whitespace-nowrap">
                    LIVE WATCH:
                  </span>
                  {(screenerStatus?.tickers || []).slice(0, 10).map((t) => (
                    <button
                      key={t.symbol}
                      type="button"
                      onClick={() => onSelectSymbol(t.symbol)}
                      className={`px-2 py-0.5 text-[10px] font-mono tabular-nums border whitespace-nowrap shrink-0 transition-colors ${
                        t.symbol === symbol
                          ? 'bg-[#F59E0B]/15 border-[#F59E0B] text-[#F59E0B]'
                          : 'bg-[#0C1017] border-[#1E2634] text-[#8B95A5] hover:text-[#E6EDF3]'
                      }`}
                    >
                      <span className="font-bold mr-1">{t.symbol}</span>
                      <span className={t.change24hPct >= 0 ? 'text-[#089981]' : 'text-[#F23645]'}>
                        {t.change24hPct >= 0 ? '+' : ''}
                        {t.change24hPct.toFixed(1)}%
                      </span>
                    </button>
                  ))}
                </div>

                {/* Zoomable Market Chart (broadcastMode strips Backtest/Paper) */}
                <TerminalWorkspaceChart
                  symbol={symbol}
                  timeframe={timeframe}
                  provider={provider}
                  candles={candles}
                  trades={[]}
                  equityCurve={[]}
                  initialCapital={100}
                  selectedTradeId={null}
                  onSelectTrade={() => {}}
                  fastEmaPeriod={fastEmaPeriod}
                  slowEmaPeriod={slowEmaPeriod}
                  openPaperPositions={[]}
                  liveOrderbook={liveOrderbook}
                  broadcastMode={true}
                />

                {studioLayout === 'FULL' ? (
                  renderRadarDeck()
                ) : (
                  /* FOCUS MODE: Enlarged Studio Teleprompter + 30m Key Takeaway Strip */
                  <div className="flex-1 flex flex-col min-h-0 bg-[#0B0F15] p-4 justify-center gap-3">
                    <div className="max-w-4xl space-y-2">
                      <div className="text-[10px] font-mono uppercase tracking-wider text-[#F59E0B]">
                        FOKUS LIVE-TRANSKRIPT · {activeOrLast?.symbol || symbol}
                      </div>
                      <p className="text-xl leading-relaxed font-semibold text-[#E6EDF3]">
                        {activeOrLast?.spokenText ||
                          'Der Live-Kommentator wartet auf das nächste Marktsignal oder News-Update.'}
                      </p>
                      {activeOrLast?.metaFactSummary && (
                        <div className="text-xs font-mono text-[#8B95A5]">
                          {activeOrLast.metaFactSummary}
                        </div>
                      )}
                    </div>
                    {keyTakeawayReport && (
                      <div className="max-w-4xl pt-2 border-t border-[#1E2634] flex items-center justify-between gap-3 text-[11px] font-mono">
                        <span className="text-[#00E5FF] truncate">
                          30M KEY TAKEAWAY ({keyTakeawayReport.forecastBias}):{' '}
                          {keyTakeawayReport.recommendations
                            .slice(0, 3)
                            .map((r) => `${r.symbol} ${r.direction} ${r.entryPrice}`)
                            .join(' · ')}
                        </span>
                        <button
                          type="button"
                          onClick={() => setStudioLayout('FULL')}
                          className="text-[#F59E0B] hover:underline whitespace-nowrap shrink-0"
                        >
                          Alle 5 Setups öffnen
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Right Broadcast Column: Analog VU Rack + Teleprompter + Chronicle */}
              <aside className="w-[380px] xl:w-[430px] flex flex-col min-h-0 shrink-0">
                {renderAudioDeskAndChronicle(studioLayout === 'FOCUS')}
              </aside>
            </div>
          )}

          {/* Vintage TV Börsenstudio Bottom Chyron / News Laufband */}
          {tickerEntries.length > 0 && (
            <div className="bg-[#141008] border-t border-[#D97706]/50 h-7 flex items-center overflow-hidden shrink-0">
              <div className="px-2.5 h-full bg-[#D97706] text-[#07090E] font-mono font-bold text-[10px] flex items-center whitespace-nowrap shrink-0">
                {tickerPaused ? 'TICKER HALT' : 'LIVE BÖRSENTICKER'}
              </div>
              <div className="flex-1 overflow-hidden relative h-full flex items-center">
                <div
                  className={`animate-studio-ticker font-mono tabular-nums text-[11px] ${
                    tickerPaused ? 'animate-studio-ticker-paused' : ''
                  }`}
                >
                  {[...tickerEntries, ...tickerEntries].map((item, idx) => (
                    <button
                      key={`${item.id}-${idx}`}
                      type="button"
                      onClick={item.onClick}
                      className="inline-flex items-center gap-2 px-4 hover:text-[#F59E0B] whitespace-nowrap"
                    >
                      <span className="text-[#F59E0B] font-bold">{item.tag}</span>
                      <span className={item.isPositive ? 'text-[#E6EDF3]' : 'text-[#FCA5A5]'}>
                        {item.text}
                      </span>
                      <span className="text-[#566173]" aria-hidden="true">
                        │
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* PAGE 2: PROP FIRM CHALLENGE ARENA (LuxAlgo prop-firm-sim) */}
      {streamPage === 'PROP_FIRM' && (
        <PropFirmArenaPage
          backtestResult={backtestResult}
          activeSymbol={symbol}
          activeTimeframe={timeframe}
          onVoiceBriefing={(firmName, challengeName, passPct, optRisk, evUsd) => {
            voiceCommentatorService.announcePropFirmBriefing(
              firmName,
              challengeName,
              passPct,
              optRisk,
              evUsd
            );
          }}
        />
      )}
    </div>
  );
};
