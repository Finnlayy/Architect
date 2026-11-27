/**
 * OMEGA NIO — Hybrid 5-Agent Market Convergence & Pure Teleprompter Context Engine
 *
 * Architecture:
 *  - Pure Teleprompter Script Extractor: strips UI chrome & redundant payloads,
 *    passing pure sanitized script text + minimal numeric market deltas (~130 tokens).
 *  - 5 Strictly Isolated Parallel Personas (Promise.all, zero shared CoT):
 *      Fixed Risk Corset (3):
 *        1. Analytischer Stratege (Charon) — Risk minimization & R:R structure
 *        2. Datengetriebener Skeptiker (Kore) — Challenges news vs RVOL/liquidity
 *        3. Geduldiger Mean-Reversion-Händler (Zephyr) — Overextension & extremes
 *      Adaptive Parties (2):
 *        4. Impulsiver Trendfolger (Fenrir) — Momentum & RVOL breakout bursts
 *        5. Opportunistischer News-Trader (Puck) — Event volatility & catalysts
 *  - Risk-Corset Veto & Deterministic Entry / Stop-Loss / Take-Profit Synthesizer.
 */
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  AgentConvergenceDecision,
  AgentConvergenceState,
  AgentConvergenceTrigger,
  AgentExecutionConfig,
  AgentPaperExecutionRecord,
  AgentPersonaId,
  AgentPersonaMeta,
  AgentStance,
  AgentTradeSetup,
  AgentVote,
  CmcIntelligencePayload,
  FinanceNewsPayload,
  PionexUniversePayload,
  PureTeleprompterContext,
  ScreenerScheduleStatus,
} from '../types/terminal.ts';

const GEMINI_MODEL = 'gemini-4-hydrogen';
const AGENT_TIMEOUT_MS = 6500;
const MAX_DECISIONS = 24;
const MAX_EXECUTIONS = 30;
const MAX_COOLDOWNS = 100;

export const AGENT_PERSONAS: AgentPersonaMeta[] = [
  {
    id: 'STRATEGIST',
    name: 'Analytischer Stratege',
    shortLabel: 'Stratege',
    group: 'RISK_CORSET',
    googleVoice: 'Charon',
    voicePitch: 0.92,
    voiceRate: 0.96,
    speechStyle:
      'Deep, calm, measured German institutional risk strategist focused on capital preservation and exact risk-reward',
    description:
      'Fokus auf Risikominimierung, Positionsgröße, ATR-Absicherung und sauberes Chance-Risiko-Verhältnis (>= 1.8).',
  },
  {
    id: 'SKEPTIC',
    name: 'Datengetriebener Skeptiker',
    shortLabel: 'Skeptiker',
    group: 'RISK_CORSET',
    googleVoice: 'Kore',
    voicePitch: 0.98,
    voiceRate: 1.03,
    speechStyle:
      'Sharp, questioning, forensic German financial analyst challenging headlines against raw RVOL and liquidity',
    description:
      'Hinterfragt jede Schlagzeile und jeden Spike kritisch auf Fehlausbrüche, dünne Liquidität und Divergenzen.',
  },
  {
    id: 'MEAN_REVERSION',
    name: 'Geduldiger Mean-Reversion-Händler',
    shortLabel: 'Mean-Rev',
    group: 'RISK_CORSET',
    googleVoice: 'Zephyr',
    voicePitch: 0.96,
    voiceRate: 0.94,
    speechStyle:
      'Patient, composed, contrarian German market veteran waiting for overextended extremes and VWAP snaps',
    description:
      'Wartet geduldig auf statistische Übertreibungen und verhindert das späte Hinterherlaufen in erschöpfte Spikes.',
  },
  {
    id: 'TREND_FOLLOWER',
    name: 'Impulsiver Trendfolger',
    shortLabel: 'Trendfolger',
    group: 'ADAPTIVE',
    googleVoice: 'Fenrir',
    voicePitch: 1.06,
    voiceRate: 1.12,
    speechStyle:
      'Energetic, decisive, fast-paced German momentum trader riding RVOL breakouts and strong directional flow',
    description:
      'Reitet dynamisches RVOL-Momentum und Trendbeschleunigung adaptiv bei Ausbrüchen in Echtzeit.',
  },
  {
    id: 'NEWS_TRADER',
    name: 'Opportunistischer News-Trader',
    shortLabel: 'News-Trader',
    group: 'ADAPTIVE',
    googleVoice: 'Puck',
    voicePitch: 1.08,
    voiceRate: 1.14,
    speechStyle:
      'Bright, urgent, opportunistic German breaking-news trader reacting immediately to macro and headline volatility',
    description:
      'Lauert auf Event-Volatilität durch Makro-Daten, Yahoo/MSN-Eilmeldungen und plötzliche Sektor-Katalysatoren.',
  },
];

const PERSONA_WEIGHTS: Record<AgentPersonaId, number> = {
  STRATEGIST: 0.24,
  SKEPTIC: 0.22,
  MEAN_REVERSION: 0.18,
  TREND_FOLLOWER: 0.18,
  NEWS_TRADER: 0.18,
};

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

const decisionHistory: AgentConvergenceDecision[] = [];
const executionHistory: AgentPaperExecutionRecord[] = [];
const symbolExecutionCooldown = new Map<string, number>();
let inflightEvalPromise: Promise<AgentConvergenceDecision> | null = null;

let executionConfig: AgentExecutionConfig = {
  autoExecuteEnabled: true,
  minConvergencePct: 75,
  maxRiskPctPerTrade: 3,
  cooldownSecPerSymbol: 300,
  autoSpeakDebate: true,
};

function cleanPlainText(input: unknown, maxLen: number): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_`#>|[\]]/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function formatPriceStr(price: number): string {
  if (!Number.isFinite(price) || price <= 0) return '$0.00';
  if (price >= 1000) return `$${price.toFixed(0)}`;
  if (price >= 10) return `$${price.toFixed(2)}`;
  if (price >= 0.1) return `$${price.toFixed(4)}`;
  return `$${price.toFixed(6)}`;
}

function formatHms(ts: number): string {
  return new Date(ts).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export interface AgentEvaluateMarketInput {
  activeSymbol: string;
  teleprompterScript: string;
  trigger: AgentConvergenceTrigger;
  screener: ScreenerScheduleStatus;
  cmc: CmcIntelligencePayload;
  pionex: PionexUniversePayload;
  news: FinanceNewsPayload;
  livePriceGetter?: (sym: string) => number | undefined;
}

/**
 * Economical Pure Teleprompter Script Extractor:
 * Strips UI noise & redundant fields to feed minimal-token pure text context to the 5 parallel agents.
 */
export function extractPureTeleprompterContext(
  input: AgentEvaluateMarketInput
): PureTeleprompterContext {
  const sym = (input.activeSymbol || 'BTC/USD').toUpperCase().trim();
  const base = sym.split('/')[0].replace(/USDT\.?P?$/i, '');

  const scrTicker =
    input.screener.tickers.find((t) => t.symbol.toUpperCase() === sym) ||
    input.screener.tickers.find((t) => t.symbol.toUpperCase().startsWith(base)) ||
    input.screener.tickers[0];

  const pxTicker =
    input.pionex.tickers.find((p) => p.canonicalSymbol.toUpperCase() === sym) ||
    input.pionex.tickers.find((p) => p.baseAsset.toUpperCase() === base);

  const cmcAsset = input.cmc.rankedAssets.find((a) => a.symbol.toUpperCase() === base);

  const livePrice =
    input.livePriceGetter?.(sym) ||
    scrTicker?.price ||
    pxTicker?.price ||
    cmcAsset?.price ||
    0;

  const change24hPct =
    scrTicker?.change24hPct ?? pxTicker?.change24hPct ?? cmcAsset?.change24hPct ?? 0;
  const rvol = scrTicker?.rvol ?? pxTicker?.rvolScore ?? 1.0;
  const fearAndGreedIndex = input.cmc.globalMetrics?.fearAndGreedIndex ?? 50;

  const matchingNews =
    input.news.items.find((n) => n.symbol.toUpperCase().includes(base)) ||
    input.news.items[0];
  const matchingSignal =
    input.cmc.signals.find((s) => s.symbol.toUpperCase().includes(base)) ||
    input.cmc.signals[0];

  const macroHeadline = cleanPlainText(
    matchingNews?.title || matchingSignal?.headline || 'Keine dominante Makro-Schlagzeile.',
    120
  );

  let rawScriptText = cleanPlainText(input.teleprompterScript, 360);
  if (!rawScriptText) {
    const latestChron = input.screener.chronicle.find((c) => c.symbol.toUpperCase() === sym) ||
      input.screener.chronicle[0];
    rawScriptText = cleanPlainText(
      latestChron
        ? `${latestChron.symbol} ${latestChron.headline}. ${latestChron.detail}`
        : `${sym} handelt bei ${formatPriceStr(livePrice)} (${change24hPct >= 0 ? '+' : ''}${change24hPct.toFixed(2)}%, RVOL ${rvol.toFixed(1)}x).`,
      360
    );
  }

  // Strictly block internal paper/backtest terminology from pure context
  rawScriptText = rawScriptText
    .replace(/\b(paper[_ -]?book|paper[_ -]?fill|order[_ -]?fill|backtest|bt equity)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const extractedPrompt = [
    `SYM:${sym}|PX:${livePrice > 0 ? livePrice.toFixed(livePrice >= 10 ? 2 : 5) : '0'}|24H:${change24hPct >= 0 ? '+' : ''}${change24hPct.toFixed(2)}%|RVOL:${rvol.toFixed(2)}x|F&G:${fearAndGreedIndex}|TRIG:${input.trigger}`,
    `MACRO:${macroHeadline}`,
    `SCRIPT:${rawScriptText}`,
  ].join('\n');

  const charCount = extractedPrompt.length;
  const estTokens = Math.max(20, Math.ceil(charCount / 4));

  return {
    rawScriptText,
    extractedPrompt,
    symbol: sym,
    price: livePrice,
    change24hPct: Number(change24hPct.toFixed(2)),
    rvol: Number(rvol.toFixed(2)),
    fearAndGreedIndex,
    macroHeadline,
    charCount,
    estTokens,
  };
}

function buildPersonaSystemInstruction(persona: AgentPersonaMeta): string {
  const roleSpecific: Record<AgentPersonaId, string> = {
    STRATEGIST: [
      'Du bist der ANALYTISCHE STRATEGE (Festes Risiko-Korsett).',
      'Fokus: Risikominimierung, sauberes Chance-Risiko-Verhältnis, Kapitalerhalt.',
      'Wenn RVOL < 1.2x oder Kursänderung extrem ohne Struktur ist, wähle NEUTRAL oder VETO.',
      'Kommunikationsstil: Nüchtern, strukturiert, prägnante Risikobegründung.',
    ].join('\n'),
    SKEPTIC: [
      'Du bist der DATENGETRIEBENE SKEPTIKER (Festes Risiko-Korsett).',
      'Fokus: Hinterfrage jede Nachricht und jeden Kurssprung auf Fake-Outs, dünnes Volumen oder Übertreibung.',
      'Wenn Schlagzeile und RVOL/24h-Daten widersprüchlich wirken oder Fear&Greed extrem ist (>78 oder <22), wähle VETO oder Gegenposition.',
      'Kommunikationsstil: Kritisch, direkt, datenfokussiert.',
    ].join('\n'),
    MEAN_REVERSION: [
      'Du bist der GEDULDIGE MEAN-REVERSION-HÄNDLER (Festes Risiko-Korsett).',
      'Fokus: Extreme Abweichungen (>4% 24h Move oder extreme Stimmung) auf Rückkehr zum Mittelwert prüfen.',
      'Laufe keinem überdehnten Impuls hinterher — bei Überdehnung eher Gegenrichtung oder NEUTRAL/VETO gegen spätes Chasing.',
      'Kommunikationsstil: Ruhig, abwartend, antizyklisch.',
    ].join('\n'),
    TREND_FOLLOWER: [
      'Du bist der IMPULSIVE TRENDFOLGER (Adaptiv).',
      'Fokus: Momentum und RVOL-Ausbrüche (>=1.5x) in Trendrichtung reiten.',
      'Bei positivem Momentum + starkem RVOL favorisiere LONG; bei klarem Abwärtsdruck SHORT.',
      'Kommunikationsstil: Energetisch, direkt, aktionsorientiert.',
    ].join('\n'),
    NEWS_TRADER: [
      'Du bist der OPPORTUNISTISCHE NEWS-TRADER (Adaptiv).',
      'Fokus: Event-Volatilität durch Makro-Headlines und Teleprompter-Katalysatoren sofort nutzen.',
      'Bewerte, ob das Teleprompter-Skript / die News kurzfristige Folgebewegung auslöst.',
      'Kommunikationsstil: Schnell, schlagfertig, katalysatorfokussiert.',
    ].join('\n'),
  };

  return [
    roleSpecific[persona.id],
    'WICHTIGE ISOLATIONSREGEL: Argumentiere ausschließlich aus deiner eigenen Rolle auf Basis des gelieferten kompakten Marktkontexts.',
    'Antworte im JSON-Format mit:',
    '- stance: "LONG" | "SHORT" | "NEUTRAL" | "VETO"',
    '- confidence: Ganzzahl 0 bis 100',
    '- thesis: 1 bis maximal 2 kurze, flüssig sprechbare deutsche Sätze (max 210 Zeichen) im Stil deiner Persona.',
    '- riskNote: Kurze Risiko-Notiz (max 90 Zeichen).',
  ].join('\n');
}

function buildDeterministicAgentVote(
  persona: AgentPersonaMeta,
  ctx: PureTeleprompterContext,
  latencyMs: number
): AgentVote {
  const { symbol, change24hPct, rvol, fearAndGreedIndex, macroHeadline } = ctx;
  const isBullMove = change24hPct >= 0.4;
  const isBearMove = change24hPct <= -0.4;
  const highRvol = rvol >= 1.8;
  const extremeOverbought = change24hPct >= 5.5 || fearAndGreedIndex >= 80;
  const extremeOversold = change24hPct <= -5.5 || fearAndGreedIndex <= 20;

  let stance: AgentStance = 'NEUTRAL';
  let confidence = 55;
  let thesis = '';
  let riskNote = '';

  switch (persona.id) {
    case 'STRATEGIST': {
      if (highRvol && Math.abs(change24hPct) >= 0.8 && Math.abs(change24hPct) <= 4.5) {
        stance = isBullMove ? 'LONG' : 'SHORT';
        confidence = 76;
        thesis = `${symbol} bietet mit RVOL ${rvol.toFixed(1)}x eine saubere Stop-Struktur; Risiko strikt auf maximal 3 Prozent begrenzen.`;
        riskNote = 'Enges ATR-Stop-Korsett aktiv.';
      } else if (Math.abs(change24hPct) > 6.0) {
        stance = 'VETO';
        confidence = 78;
        thesis = `${symbol} ist mit ${change24hPct.toFixed(1)} Prozent bereits zu weit gelaufen — kein sauberes Chance-Risiko für einen Neueinstieg.`;
        riskNote = 'VETO wegen überdehntem Stop-Abstand.';
      } else {
        stance = 'NEUTRAL';
        confidence = 62;
        thesis = `Bei ${symbol} fehlt mir aktuell das Volumen-zu-Risiko-Verhältnis für ein asymmetrisches Setup.`;
        riskNote = 'Abwarten auf klare RVOL-Bestätigung.';
      }
      break;
    }
    case 'SKEPTIC': {
      if (rvol < 1.35) {
        stance = 'VETO';
        confidence = 74;
        thesis = `Achtung bei ${symbol}: Nur ${rvol.toFixed(1)}x RVOL — die Meldung trägt ohne echten Orderflow keinen nachhaltigen Ausbruch.`;
        riskNote = 'VETO: Geringes relatives Volumen.';
      } else if (extremeOverbought) {
        stance = 'VETO';
        confidence = 72;
        thesis = `Skepsis bei ${symbol}: Fear & Greed bei ${fearAndGreedIndex} und ${change24hPct.toFixed(1)} Prozent Anstieg riechen nach Bull-Trap.`;
        riskNote = 'Euphorie- & Liquidationsrisiko hoch.';
      } else {
        stance = isBullMove ? 'LONG' : isBearMove ? 'SHORT' : 'NEUTRAL';
        confidence = 68;
        thesis = `Die Daten für ${symbol} halten dem Check stand: RVOL ${rvol.toFixed(1)}x bestätigt die Bewegung hinter der Schlagzeile.`;
        riskNote = 'Orderflow-Bestätigung vorhanden.';
      }
      break;
    }
    case 'MEAN_REVERSION': {
      if (extremeOverbought) {
        stance = 'SHORT';
        confidence = 71;
        thesis = `${symbol} ist mit plus ${change24hPct.toFixed(1)} Prozent extrem überdehnt; ich erwarte eine geduldige Rückkehr zum VWAP.`;
        riskNote = 'Gegen-Trend nur mit klarem Hoch-Stop.';
      } else if (extremeOversold) {
        stance = 'LONG';
        confidence = 72;
        thesis = `Nach minus ${Math.abs(change24hPct).toFixed(1)} Prozent bei Fear & Greed ${fearAndGreedIndex} zeigt ${symbol} ein klassisches Erschöpfungs-Extrem.`;
        riskNote = 'Gestaffelter Einstieg am Support.';
      } else {
        stance = 'NEUTRAL';
        confidence = 60;
        thesis = `${symbol} handelt im normalen Gleichgewichtsbereich — als Mean-Reversion-Händler warte ich auf ein statistisches Extrem.`;
        riskNote = 'Kein Z-Score-Extrem erreicht.';
      }
      break;
    }
    case 'TREND_FOLLOWER': {
      if (isBullMove && rvol >= 1.3) {
        stance = 'LONG';
        confidence = Math.min(92, Math.round(68 + rvol * 6));
        thesis = `Volles Momentum bei ${symbol}! Mit ${rvol.toFixed(1)}x RVOL und plus ${change24hPct.toFixed(1)} Prozent reiten wir den Ausbruch long.`;
        riskNote = 'Momentum-Trail nachziehen.';
      } else if (isBearMove && rvol >= 1.3) {
        stance = 'SHORT';
        confidence = Math.min(90, Math.round(66 + rvol * 6));
        thesis = `Verkaufsdruck beschleunigt sich bei ${symbol} auf ${rvol.toFixed(1)}x RVOL — ich gehe sofort mit dem Abwärtstrend.`;
        riskNote = 'Trend-Follow bei fallenden Tiefs.';
      } else {
        stance = 'NEUTRAL';
        confidence = 54;
        thesis = `${symbol} konsolidiert noch seitwärts; sobald RVOL über 1.5x springt, bin ich sofort im Trend.`;
        riskNote = 'Warte auf Breakout-Impuls.';
      }
      break;
    }
    case 'NEWS_TRADER': {
      const lowerMacro = macroHeadline.toLowerCase();
      const bullNews = /surge|rally|etf|approval|inflow|growth|record|breakout|beat|bullish/.test(
        lowerMacro
      );
      const bearNews = /crash|drop|ban|hack|sec|lawsuit|rate hike|inflation|bearish|selloff/.test(
        lowerMacro
      );
      if (bullNews || (isBullMove && rvol >= 1.4)) {
        stance = 'LONG';
        confidence = 77;
        thesis = `Starker News-Katalysator für ${symbol}: "${macroHeadline.slice(0, 65)}" treibt frische Volatilität in den Markt.`;
        riskNote = 'Event-Spike zügig teilgewinnen.';
      } else if (bearNews || (isBearMove && rvol >= 1.4)) {
        stance = 'SHORT';
        confidence = 75;
        thesis = `Negativer News-Impuls belastet ${symbol}; erhöhte Event-Volatilität spricht für schnellen Short-Druck.`;
        riskNote = 'Headline-Reversal im Blick behalten.';
      } else {
        stance = 'NEUTRAL';
        confidence = 56;
        thesis = `Die aktuelle Meldung zu ${symbol} liefert noch keinen harten Volatilitäts-Schock für einen News-Trade.`;
        riskNote = 'Lauerstellung auf Breaking Catalyst.';
      }
      break;
    }
  }

  return {
    agentId: persona.id,
    agentName: persona.name,
    group: persona.group,
    googleVoice: persona.googleVoice,
    voicePitch: persona.voicePitch,
    voiceRate: persona.voiceRate,
    speechStyle: persona.speechStyle,
    stance,
    confidence,
    thesis,
    riskNote,
    latencyMs,
    generatedBy: 'deterministic',
  };
}

async function evaluateSingleAgent(
  persona: AgentPersonaMeta,
  ctx: PureTeleprompterContext
): Promise<AgentVote> {
  const started = Date.now();
  const ai = getGeminiClient();
  if (!ai) {
    return buildDeterministicAgentVote(persona, ctx, Math.max(4, Date.now() - started));
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    const apiCall = ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: `Bewerte diesen reinen Teleprompter-Kontext isoliert aus deiner Rolle:\n${ctx.extractedPrompt}`,
      config: {
        systemInstruction: buildPersonaSystemInstruction(persona),
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            stance: { type: Type.STRING },
            confidence: { type: Type.INTEGER },
            thesis: { type: Type.STRING },
            riskNote: { type: Type.STRING },
          },
        },
      },
    });

    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Agent timeout')), AGENT_TIMEOUT_MS);
    });

    const resp = await Promise.race([apiCall, timeout]);
    const parsed = JSON.parse((resp.text ?? '{}').trim());
    const rawStance = String(parsed.stance || '').toUpperCase();
    const stance: AgentStance =
      rawStance === 'LONG' || rawStance === 'SHORT' || rawStance === 'VETO'
        ? rawStance
        : 'NEUTRAL';
    const confNum = Number(parsed.confidence);
    const confidence = Number.isFinite(confNum)
      ? Math.max(25, Math.min(98, Math.round(confNum)))
      : 65;

    const thesis =
      cleanPlainText(parsed.thesis, 220) ||
      buildDeterministicAgentVote(persona, ctx, 0).thesis;
    const riskNote =
      cleanPlainText(parsed.riskNote, 100) || 'Risiko-Parameter aktiv.';

    return {
      agentId: persona.id,
      agentName: persona.name,
      group: persona.group,
      googleVoice: persona.googleVoice,
      voicePitch: persona.voicePitch,
      voiceRate: persona.voiceRate,
      speechStyle: persona.speechStyle,
      stance,
      confidence,
      thesis,
      riskNote,
      latencyMs: Date.now() - started,
      generatedBy: 'gemini',
    };
  } catch {
    return buildDeterministicAgentVote(persona, ctx, Date.now() - started);
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
  }
}

function synthesizeHybridDecision(
  ctx: PureTeleprompterContext,
  votes: AgentVote[],
  trigger: AgentConvergenceTrigger,
  totalLatencyMs: number
): AgentConvergenceDecision {
  const now = Date.now();
  let longScore = 0;
  let shortScore = 0;

  for (const v of votes) {
    const w = PERSONA_WEIGHTS[v.agentId] || 0.2;
    const strength = (v.confidence / 100) * w;
    if (v.stance === 'LONG') longScore += strength;
    if (v.stance === 'SHORT') shortScore += strength;
  }

  const dominantDir: 'LONG' | 'SHORT' | 'WAIT' =
    longScore > shortScore && longScore >= 0.34
      ? 'LONG'
      : shortScore > longScore && shortScore >= 0.34
      ? 'SHORT'
      : 'WAIT';

  const fixedVotes = votes.filter((v) => v.group === 'RISK_CORSET');
  const strongVetoes = fixedVotes.filter((v) => v.stance === 'VETO' && v.confidence >= 65);
  const opposingFixed =
    dominantDir === 'WAIT'
      ? []
      : fixedVotes.filter(
          (v) =>
            v.stance !== dominantDir &&
            v.stance !== 'NEUTRAL' &&
            v.confidence >= 65
        );

  let riskCorsetVetoed = false;
  let vetoReason: string | undefined;

  if (strongVetoes.length >= 1) {
    riskCorsetVetoed = true;
    vetoReason = `Risiko-Korsett Veto (${strongVetoes.map((v) => v.agentName).join(' & ')}): ${strongVetoes[0].riskNote}`;
  } else if (opposingFixed.length >= 2) {
    riskCorsetVetoed = true;
    vetoReason = `Risiko-Korsett blockiert Adaptive-Signal (${opposingFixed.length}/3 feste Risiko-Agenten dagegen).`;
  }

  const rawConvergence = Math.round(
    (dominantDir === 'LONG' ? longScore : dominantDir === 'SHORT' ? shortScore : Math.max(longScore, shortScore)) * 100
  );
  const alignedCount =
    dominantDir === 'WAIT'
      ? 0
      : votes.filter((v) => v.stance === dominantDir).length;
  const convergencePct = Math.max(
    15,
    Math.min(98, Math.round(rawConvergence * 0.65 + (alignedCount / 5) * 35))
  );

  const consensusDirection: 'LONG' | 'SHORT' | 'WAIT' =
    riskCorsetVetoed || dominantDir === 'WAIT' ? 'WAIT' : dominantDir;

  let tradeSetup: AgentTradeSetup | null = null;
  if (consensusDirection !== 'WAIT' && ctx.price > 0) {
    const entry = ctx.price;
    const volScale = Math.min(0.03, Math.max(0.008, (Math.abs(ctx.change24hPct) * 0.0025) + 0.008));
    const slDist = entry * volScale;
    const rr = convergencePct >= 82 ? 2.5 : 2.1;
    const tpDist = slDist * rr;
    const sl =
      consensusDirection === 'LONG'
        ? Math.max(0.000001, entry - slDist)
        : entry + slDist;
    const tp =
      consensusDirection === 'LONG'
        ? entry + tpDist
        : Math.max(0.000001, entry - tpDist);

    const decimals = entry >= 1000 ? 0 : entry >= 10 ? 2 : entry >= 0.1 ? 4 : 6;
    const cleanEntry = Number(entry.toFixed(decimals));
    const cleanSl = Number(sl.toFixed(decimals));
    const cleanTp = Number(tp.toFixed(decimals));

    tradeSetup = {
      symbol: ctx.symbol,
      direction: consensusDirection,
      entryPrice: cleanEntry,
      stopLoss: cleanSl,
      takeProfit: cleanTp,
      entryStr: formatPriceStr(cleanEntry),
      stopLossStr: formatPriceStr(cleanSl),
      takeProfitStr: formatPriceStr(cleanTp),
      riskRewardRatio: rr,
      riskRewardStr: `1 : ${rr.toFixed(1)}`,
      suggestedSizePct: Math.min(
        executionConfig.maxRiskPctPerTrade,
        convergencePct >= 85 ? executionConfig.maxRiskPctPerTrade : Math.max(1, executionConfig.maxRiskPctPerTrade * 0.75)
      ),
    };
  }

  const spokenSummary = riskCorsetVetoed
    ? `Agenten-Check für ${ctx.symbol}: Das Risiko-Korsett legt sein Veto ein. Konvergenz ${convergencePct} Prozent, wir bleiben vorerst an der Seitenlinie.`
    : consensusDirection === 'WAIT'
    ? `Agenten-Check für ${ctx.symbol}: Gemischtes Votum bei ${convergencePct} Prozent Konvergenz — noch kein klares Setup.`
    : `Hohe Agenten-Konvergenz für ${ctx.symbol}: ${convergencePct} Prozent auf ${consensusDirection} ab ${tradeSetup?.entryStr}, Stop-Loss ${tradeSetup?.stopLossStr}, Take-Profit ${tradeSetup?.takeProfitStr}.`;

  return {
    id: `AC-${now}`,
    timestamp: now,
    timeFormatted: formatHms(now),
    trigger,
    context: ctx,
    votes,
    convergencePct,
    consensusDirection,
    riskCorsetVetoed,
    vetoReason,
    tradeSetup,
    spokenSummary,
    totalLatencyMs,
  };
}

export async function evaluateAgentConvergence(
  input: AgentEvaluateMarketInput
): Promise<AgentConvergenceDecision> {
  if (inflightEvalPromise) {
    return inflightEvalPromise;
  }

  inflightEvalPromise = (async () => {
    const started = Date.now();
    const ctx = extractPureTeleprompterContext(input);
    const votes = await Promise.all(
      AGENT_PERSONAS.map((persona) => evaluateSingleAgent(persona, ctx))
    );
    const decision = synthesizeHybridDecision(
      ctx,
      votes,
      input.trigger,
      Date.now() - started
    );

    decisionHistory.unshift(decision);
    if (decisionHistory.length > MAX_DECISIONS) {
      decisionHistory.length = MAX_DECISIONS;
    }
    return decision;
  })();

  try {
    return await inflightEvalPromise;
  } finally {
    inflightEvalPromise = null;
  }
}

export function canExecuteSymbolCooldown(symbol: string): {
  allowed: boolean;
  remainingSec: number;
} {
  const key = symbol.toUpperCase().trim();
  const lastTs = symbolExecutionCooldown.get(key) || 0;
  const elapsedSec = Math.floor((Date.now() - lastTs) / 1000);
  if (elapsedSec < executionConfig.cooldownSecPerSymbol) {
    return {
      allowed: false,
      remainingSec: executionConfig.cooldownSecPerSymbol - elapsedSec,
    };
  }
  return { allowed: true, remainingSec: 0 };
}

export function recordAgentExecution(record: AgentPaperExecutionRecord): void {
  if (record.status === 'EXECUTED') {
    symbolExecutionCooldown.set(record.symbol.toUpperCase().trim(), record.timestamp);
    while (symbolExecutionCooldown.size > MAX_COOLDOWNS) {
      const oldest = symbolExecutionCooldown.keys().next().value;
      if (!oldest) break;
      symbolExecutionCooldown.delete(oldest);
    }
  }
  executionHistory.unshift(record);
  if (executionHistory.length > MAX_EXECUTIONS) {
    executionHistory.length = MAX_EXECUTIONS;
  }
}

export function getAgentExecutionConfig(): AgentExecutionConfig {
  return { ...executionConfig };
}

export function updateAgentExecutionConfig(
  patch: Partial<AgentExecutionConfig>
): AgentExecutionConfig {
  if (typeof patch.autoExecuteEnabled === 'boolean') {
    executionConfig.autoExecuteEnabled = patch.autoExecuteEnabled;
  }
  if (typeof patch.minConvergencePct === 'number' && Number.isFinite(patch.minConvergencePct)) {
    executionConfig.minConvergencePct = Math.max(55, Math.min(95, Math.round(patch.minConvergencePct)));
  }
  if (typeof patch.maxRiskPctPerTrade === 'number' && Number.isFinite(patch.maxRiskPctPerTrade)) {
    executionConfig.maxRiskPctPerTrade = Math.max(1, Math.min(10, Number(patch.maxRiskPctPerTrade.toFixed(1))));
  }
  if (typeof patch.cooldownSecPerSymbol === 'number' && Number.isFinite(patch.cooldownSecPerSymbol)) {
    executionConfig.cooldownSecPerSymbol = Math.max(30, Math.min(3600, Math.round(patch.cooldownSecPerSymbol)));
  }
  if (typeof patch.autoSpeakDebate === 'boolean') {
    executionConfig.autoSpeakDebate = patch.autoSpeakDebate;
  }
  return getAgentExecutionConfig();
}

export function getAgentConvergenceState(): AgentConvergenceState {
  return {
    latest: decisionHistory[0] || null,
    history: [...decisionHistory],
    executions: [...executionHistory],
    config: getAgentExecutionConfig(),
    personas: AGENT_PERSONAS,
  };
}

export function pruneAgentConvergenceMemory(aggressive = false): number {
  let removed = 0;
  const decCap = aggressive ? 8 : MAX_DECISIONS;
  if (decisionHistory.length > decCap) {
    removed += decisionHistory.length - decCap;
    decisionHistory.length = decCap;
  }
  const execCap = aggressive ? 10 : MAX_EXECUTIONS;
  if (executionHistory.length > execCap) {
    removed += executionHistory.length - execCap;
    executionHistory.length = execCap;
  }
  const cdCap = aggressive ? 30 : MAX_COOLDOWNS;
  while (symbolExecutionCooldown.size > cdCap) {
    const oldest = symbolExecutionCooldown.keys().next().value;
    if (!oldest) break;
    symbolExecutionCooldown.delete(oldest);
    removed++;
  }
  return removed;
}
