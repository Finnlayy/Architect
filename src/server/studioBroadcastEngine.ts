/**
 * OMEGA NIO — 30-Minute Key Takeaway Broadcast Report & TV Studio Live Chat Q&A Engine
 *
 * Capabilities:
 *  1. Every 30 minutes (or on demand), synthesizes live symbol movers (Screener, Pionex, CMC, DEX)
 *     plus Yahoo/MSN/CMC headlines into:
 *      - Spoken studio broadcast bulletin
 *      - Data-driven 30-minute market forecast
 *      - 5 concrete actionable trade recommendations (Symbol, Direction, Entry, SL, TP, R:R, Catalyst)
 *  2. TV Studio Live Chat Reader & Responder:
 *      - Built-in Studio viewer/operator chat + YouTube Live URL/ID server-side poller
 *      - Automatic question detection & Gemini-grounded studio anchor answers
 *      - Strictly excludes Paper Book fills and Backtest internals
 */
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  CmcIntelligencePayload,
  FinanceNewsPayload,
  KeyTakeawayHeadline,
  KeyTakeawayMover,
  KeyTakeawayReport,
  KeyTakeawayTradeRecommendation,
  PionexUniversePayload,
  ScreenerScheduleStatus,
  StudioChatMessage,
  StudioChatSource,
  StudioLiveChatState,
} from '../types/terminal.ts';

const GEMINI_MODEL = 'gemini-4-hydrogen';
export const KEY_TAKEAWAY_INTERVAL_MS = 30 * 60 * 1000;
const MAX_REPORT_HISTORY = 12;
const MAX_CHAT_MESSAGES = 100;
const MAX_SEEN_YT_IDS = 500;
const FETCH_TIMEOUT_MS = 5000;

const BLOCKED_TERMS = [
  'paper_book',
  'paper book',
  'paper_fill',
  'paper fill',
  'order_fill',
  'backtest',
  'bt equity',
  'simulated balance',
];

let sharedAiClient: GoogleGenAI | null = null;
let lastApiKey = '';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return null;
  if (apiKey !== lastApiKey || !sharedAiClient) {
    lastApiKey = apiKey;
    sharedAiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return sharedAiClient;
}

function cleanText(input: unknown, maxLen: number): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function sanitizeSpeakable(raw: string, maxLen = 680): string {
  return raw
    .replace(/[*_`#>|[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function containsBlockedTerm(raw: string): boolean {
  const lower = raw.toLowerCase();
  return BLOCKED_TERMS.some((kw) => lower.includes(kw));
}

function formatHms(ts: number): string {
  return new Date(ts).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatPriceStr(price: number): string {
  if (!Number.isFinite(price) || price <= 0) return '$0.00';
  if (price >= 1000) return `$${price.toFixed(0)}`;
  if (price >= 10) return `$${price.toFixed(2)}`;
  if (price >= 0.1) return `$${price.toFixed(4)}`;
  return `$${price.toFixed(6)}`;
}

// ============================================================================
// 1. 30-MINUTE KEY TAKEAWAY REPORT ENGINE
// ============================================================================

export interface StudioMarketSnapshotInput {
  activeSymbol?: string;
  screener: ScreenerScheduleStatus;
  cmc: CmcIntelligencePayload;
  pionex: PionexUniversePayload;
  news: FinanceNewsPayload;
}

const reportHistory: KeyTakeawayReport[] = [];
let inflightReportPromise: Promise<KeyTakeawayReport> | null = null;

export function getLatestKeyTakeawayState(): {
  latest: KeyTakeawayReport | null;
  history: KeyTakeawayReport[];
  intervalMs: number;
} {
  return {
    latest: reportHistory[0] || null,
    history: [...reportHistory],
    intervalMs: KEY_TAKEAWAY_INTERVAL_MS,
  };
}

function collectMoversAndHeadlines(input: StudioMarketSnapshotInput): {
  topMovers: KeyTakeawayMover[];
  keyHeadlines: KeyTakeawayHeadline[];
  marketContextJson: string;
} {
  const moverMap = new Map<string, KeyTakeawayMover>();

  // 1. Screener live tickers
  for (const t of input.screener.tickers || []) {
    if (!t.symbol || moverMap.has(t.symbol)) continue;
    moverMap.set(t.symbol, {
      symbol: t.symbol,
      price: t.price,
      changePct: Number((t.change24hPct || 0).toFixed(2)),
      note: `RVOL ${(t.rvol || 1).toFixed(1)}x · ${t.provider || 'KRAKEN'}`,
    });
  }

  // 2. Pionex USDT high-RVOL & top movers
  const sortedPionex = [...(input.pionex.tickers || [])]
    .sort((a, b) => Math.abs(b.change24hPct) * b.rvolScore - Math.abs(a.change24hPct) * a.rvolScore)
    .slice(0, 12);

  for (const p of sortedPionex) {
    if (!moverMap.has(p.canonicalSymbol)) {
      moverMap.set(p.canonicalSymbol, {
        symbol: p.canonicalSymbol,
        price: p.price,
        changePct: Number(p.change24hPct.toFixed(2)),
        note: `Pionex ${p.marketType} · ${p.signalTag} · RVOL ${p.rvolScore.toFixed(1)}x`,
      });
    }
  }

  // 3. CMC top ranked assets
  for (const a of (input.cmc.rankedAssets || []).slice(0, 8)) {
    const sym = `${a.symbol}/USD`;
    if (!moverMap.has(sym)) {
      moverMap.set(sym, {
        symbol: sym,
        price: a.price,
        changePct: Number(a.change24hPct.toFixed(2)),
        note: `CMC #${a.cmcRank} · ${a.tag}`,
      });
    }
  }

  const topMovers = [...moverMap.values()]
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 8);

  const keyHeadlines: KeyTakeawayHeadline[] = [];
  for (const n of (input.news.items || []).slice(0, 5)) {
    if (containsBlockedTerm(n.title)) continue;
    keyHeadlines.push({
      source: n.provider === 'YAHOO_FINANCE' ? 'YAHOO' : 'MSN',
      symbol: n.symbol,
      title: cleanText(n.title, 150),
    });
  }
  for (const sig of (input.cmc.signals || []).slice(0, 3)) {
    if (containsBlockedTerm(sig.headline)) continue;
    keyHeadlines.push({
      source: sig.source || 'CMC',
      symbol: sig.symbol,
      title: cleanText(sig.headline, 150),
    });
  }

  const publicChronicle = (input.screener.chronicle || [])
    .filter((ev) => !containsBlockedTerm(`${ev.eventType} ${ev.headline}`))
    .slice(0, 6)
    .map((ev) => ({
      symbol: ev.symbol,
      type: ev.eventType,
      headline: cleanText(ev.headline, 120),
      severity: ev.severity,
      rvol: ev.rvol,
    }));

  const dexHighlights = (input.cmc.dexPairs || []).slice(0, 4).map((d) => {
    const tot = Math.max(1, d.txns24hBuys + d.txns24hSells);
    return {
      pair: d.pairSymbol,
      dex: d.dexName,
      change1hPct: d.change1hPct,
      buyPct: Math.round((d.txns24hBuys / tot) * 100),
      liquidityUsd: Math.round(d.liquidityUsd),
    };
  });

  const marketContextJson = JSON.stringify({
    activeSymbol: input.activeSymbol || 'BTC/USD',
    globalMetrics: {
      fearAndGreedIndex: input.cmc.globalMetrics?.fearAndGreedIndex ?? 50,
      fearAndGreedLabel: input.cmc.globalMetrics?.fearAndGreedLabel ?? 'NEUTRAL',
      btcDominancePct: Number((input.cmc.globalMetrics?.btcDominancePct ?? 55).toFixed(1)),
      totalMarketCapUsd: Math.round(input.cmc.globalMetrics?.totalMarketCapUsd ?? 0),
    },
    topMovers,
    keyHeadlines: keyHeadlines.slice(0, 7),
    chronicleAnomalies: publicChronicle,
    dexHighlights,
  });

  return { topMovers, keyHeadlines: keyHeadlines.slice(0, 6), marketContextJson };
}

function buildDeterministicRecommendations(
  topMovers: KeyTakeawayMover[],
  keyHeadlines: KeyTakeawayHeadline[],
  fearGreed: number
): KeyTakeawayTradeRecommendation[] {
  const candidates = topMovers.length > 0
    ? topMovers
    : [
        { symbol: 'BTC/USD', price: 76767, changePct: 1.2, note: 'Benchmark Leader' },
        { symbol: 'ETH/USD', price: 2477, changePct: -0.4, note: 'Major L1' },
        { symbol: 'SOL/USD', price: 99.7, changePct: 3.1, note: 'Momentum Leader' },
        { symbol: 'HYPE/USD', price: 77.58, changePct: 2.4, note: 'Perp Flow' },
        { symbol: 'NIO/USD', price: 5.82, changePct: 0.8, note: 'Equities Watch' },
      ];

  const recs: KeyTakeawayTradeRecommendation[] = [];
  for (let i = 0; i < 5; i++) {
    const m = candidates[i % candidates.length];
    const price = m.price > 0 ? m.price : 100;
    const isBullish = m.changePct >= 0 || (m.changePct > -0.6 && fearGreed >= 48);
    const direction: 'LONG' | 'SHORT' = isBullish ? 'LONG' : 'SHORT';
    const slDist = price * (Math.abs(m.changePct) > 4 ? 0.016 : 0.011);
    const tpDist = slDist * 2.3;
    const entry = price;
    const sl = direction === 'LONG' ? Math.max(0.0001, entry - slDist) : entry + slDist;
    const tp = direction === 'LONG' ? entry + tpDist : Math.max(0.0001, entry - tpDist);

    const matchingHeadline = keyHeadlines.find((h) =>
      h.symbol.toUpperCase().includes(m.symbol.split('/')[0].toUpperCase())
    );

    recs.push({
      rank: i + 1,
      symbol: m.symbol,
      direction,
      entryPrice: formatPriceStr(entry),
      stopLoss: formatPriceStr(sl),
      takeProfit: formatPriceStr(tp),
      riskRewardRatio: '1 : 2.3',
      confidence: Math.abs(m.changePct) >= 1.5 ? 'HIGH' : 'MEDIUM',
      catalyst: matchingHeadline
        ? `${m.note} · News: ${matchingHeadline.title.slice(0, 70)}`
        : `${m.note} (${m.changePct >= 0 ? '+' : ''}${m.changePct.toFixed(2)}% 24h)`,
    });
  }
  return recs;
}

function buildDeterministicReport(
  input: StudioMarketSnapshotInput,
  topMovers: KeyTakeawayMover[],
  keyHeadlines: KeyTakeawayHeadline[],
  reason?: string
): KeyTakeawayReport {
  const now = Date.now();
  const fg = input.cmc.globalMetrics?.fearAndGreedIndex ?? 50;
  const btcDom = input.cmc.globalMetrics?.btcDominancePct ?? 55;
  const positiveCount = topMovers.filter((m) => m.changePct >= 0).length;
  const bias: KeyTakeawayReport['forecastBias'] =
    positiveCount >= 5 && fg >= 50
      ? 'BULLISH'
      : positiveCount <= 2 && fg < 45
      ? 'BEARISH'
      : 'NEUTRAL';
  const regime: KeyTakeawayReport['marketRegime'] =
    topMovers.some((m) => Math.abs(m.changePct) >= 5)
      ? 'VOLATILE'
      : bias === 'BULLISH'
      ? 'BULLISH'
      : bias === 'BEARISH'
      ? 'BEARISH'
      : 'RANGE';

  const recommendations = buildDeterministicRecommendations(topMovers, keyHeadlines, fg);
  const leader = topMovers[0];
  const second = topMovers[1];
  const topHeadline = keyHeadlines[0];

  const forecast30mSummary =
    `Für die nächsten 30 Minuten erwarten wir ein ${
      regime === 'VOLATILE'
        ? 'volatiles Breakout-Umfeld'
        : bias === 'BULLISH'
        ? 'konstruktives Aufwärts-Momentum'
        : bias === 'BEARISH'
        ? 'defensives Abwärts-Szenario'
        : 'ausgeglichenes Range-Trading'
    } bei Fear & Greed ${fg} und ${btcDom.toFixed(1)}% BTC-Dominanz.` +
    (leader
      ? ` Haupttreiber ist ${leader.symbol} (${leader.changePct >= 0 ? '+' : ''}${leader.changePct.toFixed(2)}%).`
      : '') +
    (topHeadline ? ` News-Fokus: ${topHeadline.title}.` : '');

  const setupsSpeech = recommendations
    .slice(0, 3)
    .map((r) => `${r.rank}. ${r.symbol} ${r.direction} ab ${r.entryPrice} Ziel ${r.takeProfit}`)
    .join(', ');

  const spokenAnnouncement = sanitizeSpeakable(
    `30-Minuten Key Takeaway: ` +
      (leader
        ? `${leader.symbol} bewegt sich um ${leader.changePct >= 0 ? 'plus' : 'minus'} ${Math.abs(leader.changePct).toFixed(1)} Prozent${
            second ? `, gefolgt von ${second.symbol} mit ${second.changePct >= 0 ? 'plus' : 'minus'} ${Math.abs(second.changePct).toFixed(1)} Prozent` : ''
          }. `
        : '') +
      (topHeadline ? `Wichtigste Schlagzeile: ${topHeadline.title}. ` : '') +
      `Prognose nächste 30 Minuten: ${
        bias === 'BULLISH' ? 'leicht bullisches Momentum' : bias === 'BEARISH' ? 'erhöhter Verkaufsdruck' : 'selektive Rotation'
      } bei Fear & Greed ${fg}. ` +
      `Top Trade-Vorschläge von fünf Setups: ${setupsSpeech}. Alle 5 Setups im Studio-Deck.`
  );

  return {
    id: `KT30-${now}`,
    generatedAt: now,
    timeFormatted: formatHms(now),
    nextScheduledAt: now + KEY_TAKEAWAY_INTERVAL_MS,
    marketRegime: regime,
    forecastBias: bias,
    forecast30mSummary,
    topMoversSummary: topMovers.slice(0, 5),
    keyHeadlines,
    recommendations,
    spokenAnnouncement,
    generatedBy: 'deterministic',
    upstreamNote: reason,
  };
}

export async function generate30MinKeyTakeaway(
  input: StudioMarketSnapshotInput
): Promise<KeyTakeawayReport> {
  if (inflightReportPromise) {
    return inflightReportPromise;
  }

  inflightReportPromise = (async () => {
    const { topMovers, keyHeadlines, marketContextJson } = collectMoversAndHeadlines(input);
    const ai = getGeminiClient();

    if (!ai) {
      const report = buildDeterministicReport(
        input,
        topMovers,
        keyHeadlines,
        'GEMINI_API_KEY nicht konfiguriert — datenbasierter Studio-Bericht erstellt.'
      );
      storeReport(report);
      return report;
    }

    const systemInstruction = [
      'Du bist der Chef-Analyst und Live-Anchor eines professionellen TV-Börsenstudios.',
      'Erstelle alle 30 Minuten das strukturierte "30-Minuten Key Takeaway" Briefing auf Basis der gelieferten Live-Marktdaten und News.',
      'Anforderungen:',
      '1) Fasse die wichtigsten Symbol-Veränderungen und relevanten News/Headlines präzise zusammen.',
      '2) Gib eine aus den Daten abgeleitete Prognose für die nächsten 30 Minuten (Regime, Bias, Begründung mit Katalysatoren & Risiken).',
      '3) Empfiehle EXAKT 5 konkrete Trade-Vorschläge basierend auf den realen Preisen aus den Daten (Symbol, LONG oder SHORT, Entry, Stop-Loss, Take-Profit, R:R, Confidence, kurzer Katalysator).',
      '4) Schreibe eine sprechbare deutsche Durchsage (`spokenAnnouncement`, ca. 60-90 Wörter, maximal 640 Zeichen, keine Markdown-Sonderzeichen), die mit "30-Minuten Key Takeaway:" beginnt, die wichtigsten Movers, News, die 30-Minuten-Prognose und die Top Trade-Ideen flüssig vorträgt.',
      '5) Erwähne NIEMALS Paper-Books, Paper-Trades oder Backtest-Ergebnisse.',
    ].join('\n');

    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: `Erstelle jetzt den aktuellen 30-Minuten Key Takeaway Bericht inkl. Prognose und 5 konkreten Trade-Vorschlägen aus diesen Live-Daten:\n${marketContextJson}`,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              marketRegime: { type: Type.STRING },
              forecastBias: { type: Type.STRING },
              forecast30mSummary: { type: Type.STRING },
              spokenAnnouncement: { type: Type.STRING },
              recommendations: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    rank: { type: Type.INTEGER },
                    symbol: { type: Type.STRING },
                    direction: { type: Type.STRING },
                    entryPrice: { type: Type.STRING },
                    stopLoss: { type: Type.STRING },
                    takeProfit: { type: Type.STRING },
                    riskRewardRatio: { type: Type.STRING },
                    confidence: { type: Type.STRING },
                    catalyst: { type: Type.STRING },
                  },
                },
              },
            },
          },
        },
      });

      const raw = JSON.parse((response.text ?? '{}').trim());
      const now = Date.now();
      const fallbackRecs = buildDeterministicRecommendations(
        topMovers,
        keyHeadlines,
        input.cmc.globalMetrics?.fearAndGreedIndex ?? 50
      );

      const rawRecs = Array.isArray(raw.recommendations) ? raw.recommendations : [];
      const parsedRecs: KeyTakeawayTradeRecommendation[] = [];
      for (let i = 0; i < 5; i++) {
        const item = rawRecs[i];
        const fb = fallbackRecs[i];
        if (item && typeof item === 'object' && !containsBlockedTerm(JSON.stringify(item))) {
          const dir = String(item.direction || '').toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';
          const conf = String(item.confidence || '').toUpperCase() === 'HIGH' ? 'HIGH' : 'MEDIUM';
          parsedRecs.push({
            rank: i + 1,
            symbol: cleanText(item.symbol, 24) || fb.symbol,
            direction: dir,
            entryPrice: cleanText(item.entryPrice, 24) || fb.entryPrice,
            stopLoss: cleanText(item.stopLoss, 24) || fb.stopLoss,
            takeProfit: cleanText(item.takeProfit, 24) || fb.takeProfit,
            riskRewardRatio: cleanText(item.riskRewardRatio, 16) || fb.riskRewardRatio,
            confidence: conf,
            catalyst: cleanText(item.catalyst, 140) || fb.catalyst,
          });
        } else {
          parsedRecs.push(fb);
        }
      }

      const regimeRaw = String(raw.marketRegime || '').toUpperCase();
      const marketRegime: KeyTakeawayReport['marketRegime'] =
        regimeRaw === 'BULLISH' ||
        regimeRaw === 'BEARISH' ||
        regimeRaw === 'VOLATILE' ||
        regimeRaw === 'RANGE'
          ? regimeRaw
          : 'VOLATILE';

      const biasRaw = String(raw.forecastBias || '').toUpperCase();
      const forecastBias: KeyTakeawayReport['forecastBias'] =
        biasRaw === 'BULLISH' || biasRaw === 'BEARISH' || biasRaw === 'NEUTRAL'
          ? biasRaw
          : 'NEUTRAL';

      const forecast30mSummary =
        cleanText(raw.forecast30mSummary, 420) ||
        buildDeterministicReport(input, topMovers, keyHeadlines).forecast30mSummary;

      let spokenAnnouncement = sanitizeSpeakable(cleanText(raw.spokenAnnouncement, 680));
      if (!spokenAnnouncement || containsBlockedTerm(spokenAnnouncement)) {
        spokenAnnouncement = buildDeterministicReport(
          input,
          topMovers,
          keyHeadlines
        ).spokenAnnouncement;
      }

      const report: KeyTakeawayReport = {
        id: `KT30-${now}`,
        generatedAt: now,
        timeFormatted: formatHms(now),
        nextScheduledAt: now + KEY_TAKEAWAY_INTERVAL_MS,
        marketRegime,
        forecastBias,
        forecast30mSummary,
        topMoversSummary: topMovers.slice(0, 5),
        keyHeadlines,
        recommendations: parsedRecs,
        spokenAnnouncement,
        generatedBy: 'gemini',
        modelUsed: GEMINI_MODEL,
      };
      storeReport(report);
      return report;
    } catch (err: any) {
      const report = buildDeterministicReport(
        input,
        topMovers,
        keyHeadlines,
        err?.message ? `Gemini Fallback (${String(err.message).slice(0, 80)})` : 'Gemini Fallback'
      );
      storeReport(report);
      return report;
    }
  })();

  try {
    return await inflightReportPromise;
  } finally {
    inflightReportPromise = null;
  }
}

function storeReport(report: KeyTakeawayReport): void {
  reportHistory.unshift(report);
  if (reportHistory.length > MAX_REPORT_HISTORY) {
    reportHistory.length = MAX_REPORT_HISTORY;
  }
}

// ============================================================================
// 2. TV STUDIO LIVE CHAT READER (BUILT-IN + YOUTUBE LIVE URL/ID) & Q&A RESPONDER
// ============================================================================

const chatMessages: StudioChatMessage[] = [];
const seenYoutubeMsgIds = new Set<string>();
let autoAnswerQuestions = true;

// YouTube connection state
let youtubeConnected = false;
let youtubeVideoId: string | null = null;
let youtubeTitle: string | null = null;
let youtubeMode: StudioLiveChatState['youtubeMode'] = 'DISCONNECTED';
let youtubeActiveLiveChatId: string | null = null; // For YouTube Data API v3
let youtubeNextPageToken: string | null = null; // For Data API v3
let youtubeInnertubeKey: string | null = null; // For public YouTube live chat continuation
let youtubeContinuation: string | null = null;
let lastPollAt: number | null = null;
let pollError: string | null = null;

export function extractYoutubeVideoId(rawInput: string): string | null {
  const trimmed = cleanText(rawInput, 300);
  if (!trimmed) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }
  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    const host = url.hostname.toLowerCase();
    if (host === 'youtu.be') {
      const id = url.pathname.replace(/^\//, '').split('/')[0];
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (host.endsWith('youtube.com')) {
      const vParam = url.searchParams.get('v');
      if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) return vParam;
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && (parts[0] === 'live' || parts[0] === 'embed' || parts[0] === 'shorts')) {
        return /^[a-zA-Z0-9_-]{11}$/.test(parts[1]) ? parts[1] : null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function detectIsQuestion(rawText: string): boolean {
  const text = rawText.trim().toLowerCase();
  if (!text) return false;
  if (text.includes('?')) return true;
  if (/(^|\s)@(studio|omega|bot|ki|ai)\b/.test(text)) return true;
  return /^(wie|was|warum|wieso|wo|wann|welche[rs]?|soll|kann|lohnt|prognose|meinung|einschätzung|long|short|ziel|entry|what|why|how|when|where|which|should|could|target|btc|eth|sol)\b/i.test(
    text
  );
}

function recordSeenYtId(id: string): void {
  if (seenYoutubeMsgIds.has(id)) return;
  seenYoutubeMsgIds.add(id);
  while (seenYoutubeMsgIds.size > MAX_SEEN_YT_IDS) {
    const oldest = seenYoutubeMsgIds.values().next().value;
    if (!oldest) break;
    seenYoutubeMsgIds.delete(oldest);
  }
}

function pushChatMessage(msg: StudioChatMessage): StudioChatMessage {
  chatMessages.push(msg);
  if (chatMessages.length > MAX_CHAT_MESSAGES) {
    chatMessages.splice(0, chatMessages.length - MAX_CHAT_MESSAGES);
  }
  return msg;
}

export function addBuiltInStudioChatMessage(
  authorInput: unknown,
  textInput: unknown
): StudioChatMessage {
  const author = cleanText(authorInput, 40) || 'Studio-Viewer';
  const text = cleanText(textInput, 360);
  if (!text) {
    throw new Error('Chat-Nachricht darf nicht leer sein.');
  }
  if (containsBlockedTerm(text)) {
    throw new Error('Interne Backtest/Paper-Begriffe sind im öffentlichen Studio-Chat gesperrt.');
  }

  const now = Date.now();
  return pushChatMessage({
    id: `SC-${now}-${Math.floor(Math.random() * 900 + 100)}`,
    source: 'STUDIO',
    author,
    text,
    timestamp: now,
    timeFormatted: formatHms(now),
    isQuestion: detectIsQuestion(text),
    status: 'NEW',
  });
}

export function setStudioAutoAnswer(enabled: boolean): boolean {
  autoAnswerQuestions = Boolean(enabled);
  return autoAnswerQuestions;
}

export function disconnectYoutubeLiveChat(): StudioLiveChatState {
  youtubeConnected = false;
  youtubeVideoId = null;
  youtubeTitle = null;
  youtubeMode = 'DISCONNECTED';
  youtubeActiveLiveChatId = null;
  youtubeNextPageToken = null;
  youtubeInnertubeKey = null;
  youtubeContinuation = null;
  pollError = null;
  return getStudioChatState();
}

export async function connectYoutubeLiveChat(rawUrlOrId: unknown): Promise<StudioLiveChatState> {
  const videoId = extractYoutubeVideoId(String(rawUrlOrId || ''));
  if (!videoId) {
    throw new Error('Ungültige YouTube Live URL oder Video-ID (erwartet 11-stellige ID oder Watch/Live-Link).');
  }

  youtubeVideoId = videoId;
  youtubeTitle = `YouTube Live (${videoId})`;
  youtubeActiveLiveChatId = null;
  youtubeNextPageToken = null;
  youtubeInnertubeKey = null;
  youtubeContinuation = null;
  pollError = null;

  const ytApiKey = (process.env.YOUTUBE_API_KEY || '').trim();
  if (ytApiKey) {
    try {
      const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails,snippet&id=${encodeURIComponent(
        videoId
      )}&key=${encodeURIComponent(ytApiKey)}`;
      const res = await fetch(apiUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (res.ok) {
        const data: any = await res.json();
        const item = data?.items?.[0];
        const liveChatId = item?.liveStreamingDetails?.activeLiveChatId;
        if (item?.snippet?.title) {
          youtubeTitle = cleanText(item.snippet.title, 100);
        }
        if (liveChatId) {
          youtubeConnected = true;
          youtubeMode = 'DATA_API';
          youtubeActiveLiveChatId = liveChatId;
          await pollYoutubeLiveChat();
          return getStudioChatState();
        }
      }
    } catch {
      // fall through to public Innertube live_chat extraction
    }
  }

  // Public YouTube watch page extraction (works for public live streams without manual OAuth)
  try {
    const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    const res = await fetch(watchUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8',
      },
    });
    if (!res.ok) {
      throw new Error(`YouTube HTTP ${res.status}`);
    }
    const html = await res.text();
    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    if (titleMatch?.[1]) {
      youtubeTitle = cleanText(titleMatch[1].replace(/\s*-\s*YouTube$/i, ''), 100);
    }

    const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
    const contMatch =
      html.match(/"liveChatRenderer"[\s\S]{0,1200}?"continuation":"([^"]+)"/) ||
      html.match(/"reloadContinuationData":\{"continuation":"([^"]+)"/);

    if (!apiKeyMatch?.[1] || !contMatch?.[1]) {
      youtubeConnected = false;
      youtubeMode = 'DISCONNECTED';
      pollError = 'Kein aktiver YouTube Live-Chat für diese Video-ID gefunden (Stream offline oder Chat deaktiviert).';
      return getStudioChatState();
    }

    youtubeInnertubeKey = apiKeyMatch[1];
    youtubeContinuation = contMatch[1];
    youtubeConnected = true;
    youtubeMode = 'PUBLIC_POLL';
    await pollYoutubeLiveChat();
    return getStudioChatState();
  } catch (err: any) {
    youtubeConnected = false;
    youtubeMode = 'DISCONNECTED';
    pollError = err?.message || 'YouTube Live-Chat Verbindung fehlgeschlagen.';
    return getStudioChatState();
  }
}

function ingestYoutubeMessage(id: string, author: string, text: string, ts?: number): void {
  if (!id || seenYoutubeMsgIds.has(id)) return;
  recordSeenYtId(id);
  const cleanMsg = cleanText(text, 360);
  if (!cleanMsg || containsBlockedTerm(cleanMsg)) return;
  const timestamp = ts && Number.isFinite(ts) ? ts : Date.now();
  pushChatMessage({
    id: `YT-${id.slice(-20)}`,
    source: 'YOUTUBE',
    author: cleanText(author, 40) || 'YouTube-Viewer',
    text: cleanMsg,
    timestamp,
    timeFormatted: formatHms(timestamp),
    isQuestion: detectIsQuestion(cleanMsg),
    status: 'NEW',
  });
}

export async function pollYoutubeLiveChat(): Promise<void> {
  if (!youtubeConnected || !youtubeVideoId) return;
  lastPollAt = Date.now();

  const ytApiKey = (process.env.YOUTUBE_API_KEY || '').trim();
  if (youtubeMode === 'DATA_API' && youtubeActiveLiveChatId && ytApiKey) {
    try {
      let url = `https://www.googleapis.com/youtube/v3/liveChat/messages?liveChatId=${encodeURIComponent(
        youtubeActiveLiveChatId
      )}&part=snippet,authorDetails&maxResults=40&key=${encodeURIComponent(ytApiKey)}`;
      if (youtubeNextPageToken) {
        url += `&pageToken=${encodeURIComponent(youtubeNextPageToken)}`;
      }
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) {
        pollError = `YouTube Data API HTTP ${res.status}`;
        return;
      }
      const data: any = await res.json();
      if (data?.nextPageToken) youtubeNextPageToken = data.nextPageToken;
      for (const item of data?.items || []) {
        const msgId = String(item?.id || '');
        const author = String(item?.authorDetails?.displayName || 'YouTube');
        const msgText = String(item?.snippet?.displayMessage || '');
        const publishedMs = item?.snippet?.publishedAt ? Date.parse(item.snippet.publishedAt) : Date.now();
        ingestYoutubeMessage(msgId, author, msgText, publishedMs);
      }
      pollError = null;
      return;
    } catch (err: any) {
      pollError = err?.message || 'YouTube Data API Polling-Fehler';
      return;
    }
  }

  if (youtubeMode === 'PUBLIC_POLL' && youtubeInnertubeKey && youtubeContinuation) {
    try {
      const endpoint = `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${encodeURIComponent(
        youtubeInnertubeKey
      )}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'WEB',
              clientVersion: '2.20241101.01.00',
            },
          },
          continuation: youtubeContinuation,
        }),
      });
      if (!res.ok) {
        pollError = `YouTube Live-Chat HTTP ${res.status}`;
        return;
      }
      const data: any = await res.json();
      const chatCont = data?.continuationContents?.liveChatContinuation;
      const nextCont =
        chatCont?.continuations?.[0]?.invalidationContinuationData?.continuation ||
        chatCont?.continuations?.[0]?.timedContinuationData?.continuation;
      if (nextCont) youtubeContinuation = nextCont;

      for (const act of chatCont?.actions || []) {
        const renderer = act?.addChatItemAction?.item?.liveChatTextMessageRenderer;
        if (!renderer) continue;
        const msgId = String(renderer.id || '');
        const author = String(renderer.authorName?.simpleText || 'YouTube-Viewer');
        const runs = Array.isArray(renderer.message?.runs) ? renderer.message.runs : [];
        const text = runs.map((r: any) => r?.text || '').join('');
        ingestYoutubeMessage(msgId, author, text);
      }
      pollError = null;
    } catch (err: any) {
      pollError = err?.message || 'YouTube Chat Abruf fehlgeschlagen.';
    }
  }
}

export function getStudioChatState(): StudioLiveChatState {
  return {
    youtubeConnected,
    youtubeVideoId,
    youtubeTitle,
    youtubeMode,
    lastPollAt,
    pollError,
    autoAnswerQuestions,
    messages: [...chatMessages],
  };
}

export async function generateLiveChatQaReply(
  messageId: string,
  marketInput: StudioMarketSnapshotInput
): Promise<StudioChatMessage> {
  const target = chatMessages.find((m) => m.id === messageId);
  if (!target) {
    throw new Error('Chat-Nachricht nicht gefunden.');
  }
  if (target.status === 'ANSWERED' && target.answerText) {
    return target;
  }

  const { topMovers, keyHeadlines } = collectMoversAndHeadlines(marketInput);
  const latestReport = reportHistory[0] || null;
  const ai = getGeminiClient();

  let answerText = '';
  let answeredBy: 'gemini' | 'deterministic' = 'deterministic';

  if (ai) {
    try {
      const contextPayload = JSON.stringify({
        viewerName: target.author,
        viewerSource: target.source,
        viewerQuestion: target.text,
        activeSymbol: marketInput.activeSymbol || 'BTC/USD',
        fearAndGreed: marketInput.cmc.globalMetrics?.fearAndGreedIndex,
        btcDominancePct: marketInput.cmc.globalMetrics?.btcDominancePct,
        topMovers: topMovers.slice(0, 6),
        latestHeadlines: keyHeadlines.slice(0, 4),
        latest30mForecast: latestReport?.forecast30mSummary,
        topTradeIdeas: latestReport?.recommendations.slice(0, 3),
      });

      const systemInstruction = [
        'Du bist der Live-Moderator im Vintage TV-Börsenstudio und beantwortest gerade eine Zuschauerfrage aus dem Live-Chat.',
        'Regeln:',
        '- Sprich den Zuschauer kurz mit Namen an.',
        '- Antworte präzise, fundiert und direkt auf die Frage in 2 bis maximal 3 kurzen, flüssig sprechbaren Sätzen (max 320 Zeichen) auf Deutsch mit gängigen Trading-Begriffen.',
        '- Nutze ausschließlich die realen Live-Kurse, Headlines und das aktuelle 30-Minuten-Briefing aus dem Kontext.',
        '- Gib keine Garantie-Versprechen und erwähne NIEMALS Paper-Books oder Backtest-Daten.',
        '- Kein Markdown, keine Emojis, keine Hashtags.',
      ].join('\n');

      const resp = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: `Beantworte diese Live-Chat-Frage direkt für die On-Air-Durchsage:\n${contextPayload}`,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });

      const candidate = sanitizeSpeakable(resp.text || '', 360);
      if (candidate && !containsBlockedTerm(candidate)) {
        answerText = candidate;
        answeredBy = 'gemini';
      }
    } catch {
      // fall back to deterministic market-grounded answer below
    }
  }

  if (!answerText) {
    const qUpper = target.text.toUpperCase();
    const matchesBase = (sym: string): boolean => {
      const base = sym.split('/')[0].replace(/USDT\.?P?$/i, '').toUpperCase();
      return base.length >= 2 && qUpper.includes(base);
    };

    const exactRec = latestReport?.recommendations.find((r) => matchesBase(r.symbol));
    let exactMover = topMovers.find((m) => matchesBase(m.symbol));

    if (!exactMover) {
      const scr = (marketInput.screener.tickers || []).find((t) => matchesBase(t.symbol));
      if (scr) {
        exactMover = {
          symbol: scr.symbol,
          price: scr.price,
          changePct: Number((scr.change24hPct || 0).toFixed(2)),
          note: `RVOL ${(scr.rvol || 1).toFixed(1)}x`,
        };
      }
    }
    if (!exactMover) {
      const px = (marketInput.pionex.tickers || []).find((p) => matchesBase(p.canonicalSymbol));
      if (px) {
        exactMover = {
          symbol: px.canonicalSymbol,
          price: px.price,
          changePct: Number(px.change24hPct.toFixed(2)),
          note: `Pionex ${px.marketType}`,
        };
      }
    }
    if (!exactMover) {
      const cmcAsset = (marketInput.cmc.rankedAssets || []).find((a) => matchesBase(`${a.symbol}/USD`));
      if (cmcAsset) {
        exactMover = {
          symbol: `${cmcAsset.symbol}/USD`,
          price: cmcAsset.price,
          changePct: Number(cmcAsset.change24hPct.toFixed(2)),
          note: `CMC #${cmcAsset.cmcRank}`,
        };
      }
    }

    const fg = marketInput.cmc.globalMetrics?.fearAndGreedIndex ?? 50;

    if (exactRec) {
      answerText = sanitizeSpeakable(
        `${target.author}, aktuell beobachten wir bei ${exactRec.symbol} ein ${exactRec.direction}-Setup um ${exactRec.entryPrice} mit Stop ${exactRec.stopLoss} und Ziel ${exactRec.takeProfit}. Fear & Greed liegt bei ${fg}.`,
        340
      );
    } else if (exactMover) {
      answerText = sanitizeSpeakable(
        `${target.author}, ${exactMover.symbol} notiert bei ${formatPriceStr(exactMover.price)} (${exactMover.changePct >= 0 ? '+' : ''}${exactMover.changePct.toFixed(2)}% in 24h, ${exactMover.note}) bei Fear & Greed ${fg}.`,
        340
      );
    } else if (latestReport?.recommendations[0]) {
      const topRec = latestReport.recommendations[0];
      answerText = sanitizeSpeakable(
        `${target.author}, im aktuellen 30-Minuten-Fokus steht ${topRec.symbol} (${topRec.direction} um ${topRec.entryPrice}, Ziel ${topRec.takeProfit}). Fear & Greed liegt bei ${fg}.`,
        340
      );
    } else if (topMovers[0]) {
      const m0 = topMovers[0];
      answerText = sanitizeSpeakable(
        `${target.author}, ${m0.symbol} notiert bei ${formatPriceStr(m0.price)} (${m0.changePct >= 0 ? '+' : ''}${m0.changePct.toFixed(1)}% in 24h) bei Fear & Greed ${fg}.`,
        340
      );
    } else {
      answerText = sanitizeSpeakable(
        `${target.author}, der Gesamtmarkt zeigt aktuell Fear & Greed bei ${fg}; wir fokussieren auf saubere RVOL-Ausbrüche und enges Risiko-Management.`,
        340
      );
    }
  }

  target.status = 'ANSWERED';
  target.answerText = answerText;
  target.answeredAt = Date.now();
  target.answeredBy = answeredBy;

  return target;
}

export function pruneStudioBroadcastMemory(aggressive = false): number {
  let removed = 0;
  if (aggressive && reportHistory.length > 4) {
    removed += reportHistory.length - 4;
    reportHistory.length = 4;
  }
  const chatCap = aggressive ? 40 : MAX_CHAT_MESSAGES;
  if (chatMessages.length > chatCap) {
    removed += chatMessages.length - chatCap;
    chatMessages.splice(0, chatMessages.length - chatCap);
  }
  const ytCap = aggressive ? 150 : MAX_SEEN_YT_IDS;
  while (seenYoutubeMsgIds.size > ytCap) {
    const oldest = seenYoutubeMsgIds.values().next().value;
    if (!oldest) break;
    seenYoutubeMsgIds.delete(oldest);
    removed++;
  }
  return removed;
}
