/**
 * OMEGA NIO — Live Voice-Out Broadcast Commentary Generator (Server-Side)
 *
 * Uses @google/genai (`gemini-4-hydrogen`) strictly server-side via process.env.GEMINI_API_KEY
 * to synthesize authentic German analytical live-anchor market commentary combining:
 *  - Chronicle of Events anomalies
 *  - Headlines, Trends & Community Signals
 *  - CMC Intelligence rankings, Fear & Greed, BTC dominance & DEX on-chain flows
 *
 * Strictly excludes all Paper Order Fills and Backtest Results.
 */
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import {
  CommentaryCategory,
  CommentaryGenerateRequest,
  CommentaryGenerateResponse,
} from '../types/terminal';

const GEMINI_MODEL = 'gemini-4-hydrogen';
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 120;

const BLOCKED_KEYWORDS = [
  'paper_book',
  'paper book',
  'paper-book',
  'paper_fill',
  'paper fill',
  'order_fill',
  'order-fill',
  'backtest',
  'bt equity',
  'take_profit',
  'stop_loss',
  'take-profit',
  'stop-loss',
  'simulated balance',
];

const ALLOWED_CATEGORIES: Set<CommentaryCategory> = new Set([
  'CHRONICLE',
  'HEADLINE',
  'DEX_FLOW',
  'MARKET_PULSE',
]);

interface CachedEntry {
  response: CommentaryGenerateResponse;
  expiresAt: number;
}

const commentaryCache = new Map<string, CachedEntry>();

let sharedAiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return null;
  if (!sharedAiClient) {
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

function clampNumber(input: unknown, fallback = 0): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return fallback;
  return input;
}

function containsBlockedDomainTerm(raw: string): boolean {
  const lower = raw.toLowerCase();
  return BLOCKED_KEYWORDS.some((kw) => lower.includes(kw));
}

function formatCompactUsdDe(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '0 US-Dollar';
  if (usd >= 1e12) return `${(usd / 1e12).toFixed(2).replace('.', ',')} Billionen Dollar`;
  if (usd >= 1e9) return `${(usd / 1e9).toFixed(2).replace('.', ',')} Milliarden Dollar`;
  if (usd >= 1e6) return `${(usd / 1e6).toFixed(1).replace('.', ',')} Millionen Dollar`;
  if (usd >= 1e3) return `${Math.round(usd / 1e3)} Tausend Dollar`;
  return `${usd.toFixed(0)} Dollar`;
}

function sanitizeSpeakableOutput(raw: string): string {
  return raw
    .replace(/[*_`#>|[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 340);
}

function buildMetaFactSummary(req: CommentaryGenerateRequest): string {
  const mf = req.metaFacts || {};
  const parts: string[] = [];

  if (typeof mf.cmcRank === 'number' && mf.cmcRank > 0) {
    parts.push(`CMC #${mf.cmcRank}`);
  }
  if (typeof mf.fearAndGreedIndex === 'number') {
    parts.push(`Fear & Greed ${mf.fearAndGreedIndex} (${mf.fearAndGreedLabel || 'NEUTRAL'})`);
  }
  if (typeof mf.btcDominancePct === 'number') {
    parts.push(`BTC-Dom. ${mf.btcDominancePct.toFixed(1)}%`);
  }
  if (mf.matchingDexPair) {
    const dp = mf.matchingDexPair;
    const totalTx = Math.max(1, dp.txns24hBuys + dp.txns24hSells);
    const buyPct = Math.round((dp.txns24hBuys / totalTx) * 100);
    parts.push(
      `${dp.dexName} (${dp.network}): ${buyPct}% Käufe · Liq $${(dp.liquidityUsd / 1e6).toFixed(1)}M`
    );
  }
  if (mf.matchingHeadline) {
    parts.push(mf.matchingHeadline.slice(0, 75));
  }

  return parts.join(' · ') || `${req.symbol} Live-Marktdaten & CMC Intelligence`;
}

function buildDeterministicGermanAnchor(req: CommentaryGenerateRequest): string {
  const sym = req.symbol.replace(/USDT\.P|\/USD|\/USDT/gi, (m) =>
    m === '/USD' ? '' : m === 'USDT.P' ? ' Perp' : ''
  );
  const mf = req.metaFacts || {};
  const priceText =
    typeof req.price === 'number' && req.price > 0
      ? `bei ${req.price >= 100 ? req.price.toFixed(0) : req.price.toFixed(4)} Dollar`
      : '';
  const rvolText =
    typeof req.rvol === 'number' && req.rvol > 1.2
      ? `mit ${req.rvol.toFixed(1).replace('.', ',')}x RVOL`
      : '';
  const changeText =
    typeof req.changePct === 'number' && Math.abs(req.changePct) >= 0.1
      ? `(${req.changePct >= 0 ? '+' : '-'}${Math.abs(req.changePct).toFixed(1).replace('.', ',')}%)`
      : '';

  let opener = '';
  if (req.category === 'DEX_FLOW' && mf.matchingDexPair) {
    const dp = mf.matchingDexPair;
    const totalTx = Math.max(1, dp.txns24hBuys + dp.txns24hSells);
    const buyRatio = Math.round((dp.txns24hBuys / totalTx) * 100);
    opener = `${sym} DEX Flow auf ${dp.dexName}: ${buyRatio}% Buys bei ${formatCompactUsdDe(dp.liquidityUsd)} Liquidity.`;
  } else if (req.category === 'HEADLINE') {
    opener = `Headline zu ${sym}: ${req.headline}.`;
  } else if (req.category === 'MARKET_PULSE') {
    opener = `Market Update ${sym} ${priceText} ${changeText}.`;
  } else {
    switch (req.eventType) {
      case 'RVOL_SPIKE':
        opener = `${sym} RVOL Spike ${priceText} ${rvolText} ${changeText}.`;
        break;
      case 'VWAP':
        opener = `${sym} testet den VWAP ${priceText} ${rvolText}.`;
        break;
      case 'HIGH_OF_DAY':
        opener = `${sym} am High of Day Breakout ${priceText} ${rvolText}.`;
        break;
      case 'ZSCORE_BREAK':
        opener = `${sym} mit Z-Score Break ${priceText} ${rvolText}.`;
        break;
      case 'CMC_DEX_FLOW':
        opener = `${sym} On-Chain DEX Surge ${priceText} ${rvolText}.`;
        break;
      case 'CMC_HEADLINE':
        opener = `${sym} mit CMC Momentum ${priceText} ${changeText}.`;
        break;
      case 'YAHOO_NEWS':
        opener = `Yahoo Finance News zu ${sym}: ${req.headline}.`;
        break;
      case 'MSN_NEWS':
        opener = `MSN Finance News zu ${sym}: ${req.headline}.`;
        break;
      case 'PIONEX_SCAN':
        opener = `Pionex Scanner Signal bei ${sym} ${priceText} ${rvolText} ${changeText}.`;
        break;
      default:
        opener = `${sym}: ${req.headline} ${priceText}.`;
        break;
    }
  }

  let takeaway = '';
  if (mf.matchingDexPair && req.category !== 'DEX_FLOW') {
    const dp = mf.matchingDexPair;
    const totalTx = Math.max(1, dp.txns24hBuys + dp.txns24hSells);
    const buyPct = Math.round((dp.txns24hBuys / totalTx) * 100);
    takeaway = `Key Takeaway: On ${dp.dexName} liegen die Käufer bei ${buyPct}%${typeof mf.fearAndGreedIndex === 'number' ? `, Fear & Greed bei ${mf.fearAndGreedIndex}` : ''}.`;
  } else if (mf.matchingCommunityVotesPct) {
    takeaway = `Key Takeaway: Community ist zu ${Math.round(mf.matchingCommunityVotesPct)}% bullish${mf.matchingHeadline ? ` — ${mf.matchingHeadline}` : ''}.`;
  } else if (typeof mf.fearAndGreedIndex === 'number' && typeof mf.btcDominancePct === 'number') {
    takeaway = `Key Takeaway: Fear & Greed bei ${mf.fearAndGreedIndex}, BTC Dominance ${mf.btcDominancePct.toFixed(1).replace('.', ',')}%.`;
  } else if (typeof mf.cmcRank === 'number' && mf.cmcRank > 0) {
    takeaway = `Key Takeaway: CMC Rank ${mf.cmcRank}.`;
  }

  return sanitizeSpeakableOutput(`${opener.replace(/\s+/g, ' ').trim()} ${takeaway}`.trim());
}

export async function generateLiveAnchorCommentary(
  rawBody: unknown
): Promise<CommentaryGenerateResponse> {
  if (!rawBody || typeof rawBody !== 'object') {
    throw new Error('Ungültige Anfrage für Live-Kommentar.');
  }

  const body = rawBody as Record<string, unknown>;
  const eventId = cleanText(body.eventId, 120) || `EVT-${Date.now()}`;
  const rawCategory = cleanText(body.category, 32).toUpperCase() as CommentaryCategory;
  const category: CommentaryCategory = ALLOWED_CATEGORIES.has(rawCategory)
    ? rawCategory
    : 'CHRONICLE';
  const eventType = cleanText(body.eventType, 40) || 'RVOL_SPIKE';
  const symbol = cleanText(body.symbol, 28) || 'BTC/USD';
  const provider = cleanText(body.provider, 28);
  const headline = cleanText(body.headline, 240);
  const detail = cleanText(body.detail, 240);

  if (!headline) {
    throw new Error('Ereignis-Headline darf nicht leer sein.');
  }

  if (
    containsBlockedDomainTerm(eventType) ||
    containsBlockedDomainTerm(headline) ||
    containsBlockedDomainTerm(detail)
  ) {
    throw new Error(
      'Paper-Fills und Backtest-Ergebnisse sind aus der Live-Voice-Kommentierung ausgeschlossen.'
    );
  }

  const rawMf =
    body.metaFacts && typeof body.metaFacts === 'object'
      ? (body.metaFacts as Record<string, unknown>)
      : {};
  const rawDex =
    rawMf.matchingDexPair && typeof rawMf.matchingDexPair === 'object'
      ? (rawMf.matchingDexPair as Record<string, unknown>)
      : null;

  const sanitizedReq: CommentaryGenerateRequest = {
    eventId,
    category,
    eventType: eventType as CommentaryGenerateRequest['eventType'],
    symbol,
    provider,
    headline,
    detail,
    price: clampNumber(body.price, 0),
    rvol: clampNumber(body.rvol, 0),
    changePct: clampNumber(body.changePct, 0),
    severity:
      body.severity === 'BULLISH' ||
      body.severity === 'BEARISH' ||
      body.severity === 'WARNING'
        ? body.severity
        : 'NEUTRAL',
    metaFacts: {
      fearAndGreedIndex:
        typeof rawMf.fearAndGreedIndex === 'number' ? rawMf.fearAndGreedIndex : undefined,
      fearAndGreedLabel: cleanText(rawMf.fearAndGreedLabel, 32) || undefined,
      btcDominancePct:
        typeof rawMf.btcDominancePct === 'number' ? rawMf.btcDominancePct : undefined,
      ethDominancePct:
        typeof rawMf.ethDominancePct === 'number' ? rawMf.ethDominancePct : undefined,
      totalMarketCapUsd:
        typeof rawMf.totalMarketCapUsd === 'number' ? rawMf.totalMarketCapUsd : undefined,
      dexVolume24hUsd:
        typeof rawMf.dexVolume24hUsd === 'number' ? rawMf.dexVolume24hUsd : undefined,
      cmcRank: typeof rawMf.cmcRank === 'number' ? rawMf.cmcRank : undefined,
      assetChange24hPct:
        typeof rawMf.assetChange24hPct === 'number' ? rawMf.assetChange24hPct : undefined,
      assetTag: cleanText(rawMf.assetTag, 24) || undefined,
      matchingHeadline: cleanText(rawMf.matchingHeadline, 200) || undefined,
      matchingCommunitySummary: cleanText(rawMf.matchingCommunitySummary, 220) || undefined,
      matchingCommunityVotesPct:
        typeof rawMf.matchingCommunityVotesPct === 'number'
          ? rawMf.matchingCommunityVotesPct
          : undefined,
      topExchangeName: cleanText(rawMf.topExchangeName, 48) || undefined,
      topExchangeLiquidityScore:
        typeof rawMf.topExchangeLiquidityScore === 'number'
          ? rawMf.topExchangeLiquidityScore
          : undefined,
      matchingDexPair: rawDex
        ? {
            pairSymbol: cleanText(rawDex.pairSymbol, 32),
            dexName: cleanText(rawDex.dexName, 40),
            network: cleanText(rawDex.network, 24),
            liquidityUsd: clampNumber(rawDex.liquidityUsd, 0),
            volume24hUsd: clampNumber(rawDex.volume24hUsd, 0),
            txns24hBuys: clampNumber(rawDex.txns24hBuys, 0),
            txns24hSells: clampNumber(rawDex.txns24hSells, 0),
            securityScore: clampNumber(rawDex.securityScore, 0),
          }
        : undefined,
    },
  };

  // Short-term deduplication cache check
  const now = Date.now();
  const cached = commentaryCache.get(eventId);
  if (cached && cached.expiresAt > now) {
    return { ...cached.response, cached: true };
  }

  const metaFactSummary = buildMetaFactSummary(sanitizedReq);
  const ai = getGeminiClient();

  if (!ai) {
    const fallbackText = buildDeterministicGermanAnchor(sanitizedReq);
    const resp: CommentaryGenerateResponse = {
      eventId,
      spokenText: fallbackText,
      metaFactSummary,
      generatedBy: 'template',
      upstreamNote: 'GEMINI_API_KEY nicht konfiguriert — strukturierter DE-Anchor aktiv.',
    };
    saveCache(eventId, resp, now);
    return resp;
  }

  const systemInstruction = [
    'Du bist ein präziser Live-Market-Kommentator.',
    'Aufgabe: Fasse das neue Market-Event plus die wichtigsten Meta-Fakten extrem kurz, prägnant und auf den Punkt in genau 1 bis maximal 2 kurzen Sätzen (ca. 20 bis 35 Wörter) zusammen.',
    'Sprache & Stil:',
    '- Einfaches, klares Deutsch gemischt mit verständlichen englischen Trading-/Krypto-Begriffen (z. B. RVOL Spike, Breakout, Liquidity, Bullish Votes, On-Chain Flow, Fear & Greed, Key Takeaway).',
    '- Fokus direkt auf die Key Takeaways: 1) Was bewegt sich gerade? 2) Wichtigster Hintergrund-Fakt aus Headlines, Community, CMC oder DEX.',
    '- Keine Füllwörter, keine Emojis, keine Hashtags, kein Markdown, keine Bullet-Listen — direkt flüssig sprechbar.',
    '- Erwähne NIEMALS Paper-Trades, Paper-Books, Order-Fills oder Backtests.',
  ].join('\n');

  const promptPayload = JSON.stringify(
    {
      kategorie: sanitizedReq.category,
      ereignisTyp: sanitizedReq.eventType,
      symbol: sanitizedReq.symbol,
      quelle: sanitizedReq.provider || 'TERMINAL_LIVE',
      headline: sanitizedReq.headline,
      detail: sanitizedReq.detail,
      preisUsd: sanitizedReq.price || undefined,
      rvol: sanitizedReq.rvol || undefined,
      veraenderung24hPct: sanitizedReq.changePct || undefined,
      richtung: sanitizedReq.severity,
      metaFakten: sanitizedReq.metaFacts,
    },
    null,
    2
  );

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: `Fasse dieses Live-Event kurz und prägnant mit den Key Takeaways in einfachem Deutsch/Englisch zusammen:\n${promptPayload}`,
      config: {
        systemInstruction,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    const rawText = response.text;
    const spokenText = sanitizeSpeakableOutput(rawText || '');

    if (!spokenText || containsBlockedDomainTerm(spokenText)) {
      const fallbackText = buildDeterministicGermanAnchor(sanitizedReq);
      const resp: CommentaryGenerateResponse = {
        eventId,
        spokenText: fallbackText,
        metaFactSummary,
        generatedBy: 'template',
        upstreamNote: 'Leere oder gefilterte Modellantwort — strukturierten Anchor verwendet.',
      };
      saveCache(eventId, resp, now);
      return resp;
    }

    const resp: CommentaryGenerateResponse = {
      eventId,
      spokenText,
      metaFactSummary,
      generatedBy: 'gemini',
      modelUsed: GEMINI_MODEL,
    };
    saveCache(eventId, resp, now);
    return resp;
  } catch (err: any) {
    const fallbackText = buildDeterministicGermanAnchor(sanitizedReq);
    const resp: CommentaryGenerateResponse = {
      eventId,
      spokenText: fallbackText,
      metaFactSummary,
      generatedBy: 'template',
      upstreamNote: err?.message
        ? `Gemini Fallback aktiv (${String(err.message).slice(0, 80)})`
        : 'Gemini Fallback aktiv',
    };
    saveCache(eventId, resp, now);
    return resp;
  }
}

function saveCache(eventId: string, response: CommentaryGenerateResponse, now: number): void {
  const safeKey = String(eventId || '').slice(0, 96);
  if (!safeKey) return;
  if (commentaryCache.has(safeKey)) {
    commentaryCache.delete(safeKey);
  } else if (commentaryCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = commentaryCache.keys().next().value;
    if (oldestKey) commentaryCache.delete(oldestKey);
  }
  commentaryCache.set(safeKey, {
    response,
    expiresAt: now + CACHE_TTL_MS,
  });
}

export function pruneCommentaryCache(aggressive = false): number {
  const now = Date.now();
  let removed = 0;
  for (const [key, entry] of commentaryCache.entries()) {
    if (entry.expiresAt <= now) {
      commentaryCache.delete(key);
      removed++;
    }
  }
  if (aggressive && commentaryCache.size > 30) {
    while (commentaryCache.size > 30) {
      const oldestKey = commentaryCache.keys().next().value;
      if (!oldestKey) break;
      commentaryCache.delete(oldestKey);
      removed++;
    }
  }
  return removed;
}

export function getCommentaryCacheSize(): number {
  return commentaryCache.size;
}

