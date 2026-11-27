/**
 * OMEGA NIO — Prop Firm Challenge Monte Carlo & Step Tester
 * Modeled after LuxAlgo/prop-firm-sim mechanics:
 *  - Exact Static vs. Trailing EOD vs. Trailing Intraday Drawdown Floors
 *  - Prior-day Daily Loss Limit enforcement
 *  - Multi-phase Evaluation (Phase 1 -> Phase 2 -> Funded Payout Gate)
 *  - Consistency rule tracking & Risk-per-Trade EV optimization sweep
 */
import {
  BacktestResult,
  PropFirmAttemptTrade,
  PropFirmLiveAttempt,
  PropFirmPreset,
  PropFirmRiskSweepPoint,
  PropFirmSamplePath,
  PropFirmSimConfig,
  PropFirmSimulationResult,
} from '../types/terminal';

export const PROP_FIRM_PRESETS: PropFirmPreset[] = [
  {
    id: 'ftmo-100k-2step',
    firmName: 'FTMO',
    challengeName: '100K 2-Step Standard',
    category: 'CFD',
    accountSizeUsd: 100_000,
    feeUsd: 540,
    phase1TargetPct: 10,
    phase2TargetPct: 5,
    maxDailyLossPct: 5,
    maxTotalLossPct: 10,
    drawdownMode: 'STATIC',
    minTradingDays: 4,
    maxTradingDays: 60,
    consistencyMaxDayPct: 0,
    payoutTargetPct: 4,
  },
  {
    id: 'fundingpips-100k-2step',
    firmName: 'FundingPips',
    challengeName: '100K 2-Step Evaluation',
    category: 'CFD',
    accountSizeUsd: 100_000,
    feeUsd: 399,
    phase1TargetPct: 8,
    phase2TargetPct: 5,
    maxDailyLossPct: 5,
    maxTotalLossPct: 10,
    drawdownMode: 'STATIC',
    minTradingDays: 3,
    maxTradingDays: 60,
    consistencyMaxDayPct: 0,
    payoutTargetPct: 3,
  },
  {
    id: 'apex-50k-trailing',
    firmName: 'Apex Trader Funding',
    challengeName: '50K Intraday Trailing',
    category: 'FUTURES',
    accountSizeUsd: 50_000,
    feeUsd: 167,
    phase1TargetPct: 6,
    phase2TargetPct: 0,
    maxDailyLossPct: 2.5,
    maxTotalLossPct: 5,
    drawdownMode: 'TRAILING_INTRADAY',
    minTradingDays: 7,
    maxTradingDays: 45,
    consistencyMaxDayPct: 30,
    payoutTargetPct: 4,
  },
  {
    id: 'topstep-100k-eod',
    firmName: 'Topstep',
    challengeName: '100K Combine (EOD Trailing)',
    category: 'FUTURES',
    accountSizeUsd: 100_000,
    feeUsd: 99,
    phase1TargetPct: 6,
    phase2TargetPct: 0,
    maxDailyLossPct: 2,
    maxTotalLossPct: 3,
    drawdownMode: 'TRAILING_EOD',
    minTradingDays: 2,
    maxTradingDays: 45,
    consistencyMaxDayPct: 50,
    payoutTargetPct: 4,
  },
  {
    id: 'breakout-50k-crypto',
    firmName: 'Breakout Crypto',
    challengeName: '50K 1-Step Crypto Prop',
    category: 'CRYPTO',
    accountSizeUsd: 50_000,
    feeUsd: 425,
    phase1TargetPct: 10,
    phase2TargetPct: 0,
    maxDailyLossPct: 4,
    maxTotalLossPct: 6,
    drawdownMode: 'STATIC',
    minTradingDays: 3,
    maxTradingDays: 60,
    consistencyMaxDayPct: 0,
    payoutTargetPct: 4,
  },
];

function createRng(seed: number): () => number {
  let state = (seed >>> 0) || 1337;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function samplePoisson(lambda: number, rng: () => number): number {
  if (lambda <= 0.1) return 1;
  const L = Math.exp(-Math.min(12, lambda));
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L && k < 24);
  return Math.max(1, k - 1);
}

export function extractStrategyStatsFromBacktest(result: BacktestResult | null): {
  winRatePct: number;
  avgWinR: number;
  avgLossR: number;
  tradesPerDay: number;
  sourceNote: string;
} | null {
  if (!result || !result.trades || result.trades.length === 0) return null;
  const trades = result.trades;
  const wins = trades.filter((t) => t.netPnlUsd > 0);
  const losses = trades.filter((t) => t.netPnlUsd <= 0);
  const winRatePct = Number(((wins.length / trades.length) * 100).toFixed(1));
  const avgWinR =
    wins.length > 0
      ? Number(
          (
            wins.reduce((acc, t) => acc + Math.max(0.2, Math.abs(t.rMultiple || 1.2)), 0) /
            wins.length
          ).toFixed(2)
        )
      : 1.6;
  const avgLossR =
    losses.length > 0
      ? Number(
          (
            losses.reduce((acc, t) => acc + Math.max(0.3, Math.abs(t.rMultiple || 1.0)), 0) /
            losses.length
          ).toFixed(2)
        )
      : 1.0;

  const spanMs = Math.max(
    86_400_000,
    trades[trades.length - 1].exitTime - trades[0].entryTime
  );
  const days = Math.max(1, spanMs / 86_400_000);
  const tradesPerDay = Number(Math.max(1, Math.min(10, trades.length / days)).toFixed(1));

  return {
    winRatePct,
    avgWinR,
    avgLossR,
    tradesPerDay,
    sourceNote: `${trades.length} Backtest-Trades (${result.symbol} · ${result.timeframe})`,
  };
}

interface SinglePathRunResult {
  passedPhase1: boolean;
  passedPhase2: boolean;
  passedAll: boolean;
  failType: 'NONE' | 'DAILY_LOSS' | 'MAX_LOSS' | 'TIMEOUT';
  totalDays: number;
  outcome: PropFirmSamplePath['outcome'];
  equitySeries: number[];
}

function clampNum(val: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(val)) return fallback;
  return Math.max(min, Math.min(max, val));
}

export function sanitizePropFirmPreset(raw: PropFirmPreset): PropFirmPreset {
  const minDays = Math.round(clampNum(raw.minTradingDays, 0, 100, 0));
  const maxDays = Math.round(clampNum(raw.maxTradingDays, Math.max(1, minDays), 365, 60));
  return {
    ...raw,
    accountSizeUsd: Math.round(clampNum(raw.accountSizeUsd, 1000, 5_000_000, 100_000)),
    feeUsd: Math.round(clampNum(raw.feeUsd, 0, 100_000, 0)),
    phase1TargetPct: Number(clampNum(raw.phase1TargetPct, 0.5, 50, 10).toFixed(2)),
    phase2TargetPct: Number(clampNum(raw.phase2TargetPct, 0, 50, 0).toFixed(2)),
    maxDailyLossPct: Number(clampNum(raw.maxDailyLossPct, 0.5, 50, 5).toFixed(2)),
    maxTotalLossPct: Number(clampNum(raw.maxTotalLossPct, 0.5, 80, 10).toFixed(2)),
    minTradingDays: minDays,
    maxTradingDays: maxDays,
    consistencyMaxDayPct: Number(clampNum(raw.consistencyMaxDayPct, 0, 100, 0).toFixed(1)),
    payoutTargetPct: Number(clampNum(raw.payoutTargetPct, 0.5, 50, 4).toFixed(2)),
  };
}

function simulateSingleChallengePath(
  config: PropFirmSimConfig,
  riskPctOverride: number | null,
  rng: () => number,
  recordSeries: boolean
): SinglePathRunResult {
  const preset = sanitizePropFirmPreset(config.preset);
  const acc = preset.accountSizeUsd;
  const riskPct = clampNum(riskPctOverride ?? config.riskPerTradePct, 0.1, 5, 0.75);
  const winProb = clampNum(config.winRatePct / 100, 0.05, 0.95, 0.48);
  const avgWinR = clampNum(config.avgWinR, 0.2, 20, 1.8);
  const avgLossR = clampNum(config.avgLossR, 0.2, 20, 1.0);
  const tradesPerDay = clampNum(config.tradesPerDay, 0.2, 20, 3);

  const phases: Array<{ phaseNum: 1 | 2 | 3; targetPct: number }> = [
    { phaseNum: 1, targetPct: preset.phase1TargetPct },
  ];
  if (preset.phase2TargetPct > 0) {
    phases.push({ phaseNum: 2, targetPct: preset.phase2TargetPct });
  }
  phases.push({ phaseNum: 3, targetPct: preset.payoutTargetPct });

  let passedPhase1 = false;
  let passedPhase2 = false;
  let totalDays = 0;
  const series: number[] = recordSeries ? [acc] : [];

  for (const phaseObj of phases) {
    let equity = acc;
    let hwm = acc;
    const maxLossDollars = acc * (preset.maxTotalLossPct / 100);
    let drawdownFloor = acc - maxLossDollars;
    const targetEquity = acc * (1 + phaseObj.targetPct / 100);
    let phaseDays = 0;
    let bestSingleDayProfit = 0;
    let phasePassed = false;

    while (phaseDays < preset.maxTradingDays) {
      phaseDays++;
      totalDays++;
      const dayStartEquity = equity;
      const dailyFloor = dayStartEquity - acc * (preset.maxDailyLossPct / 100);
      const nTrades = samplePoisson(tradesPerDay, rng);

      for (let t = 0; t < nTrades; t++) {
        const isWin = rng() < winProb;
        const jitter = 0.85 + rng() * 0.3;
        const rMult = isWin ? avgWinR * jitter : -avgLossR * jitter;
        const tradeRiskDollars = equity * (riskPct / 100);
        const pnl = tradeRiskDollars * rMult;

        equity = Math.max(0, equity + pnl);

        if (preset.drawdownMode === 'TRAILING_INTRADAY') {
          if (equity > hwm) {
            hwm = equity;
            drawdownFloor = Math.min(acc, hwm - maxLossDollars);
          }
        }

        if (equity <= dailyFloor) {
          if (recordSeries) series.push(equity);
          return {
            passedPhase1,
            passedPhase2,
            passedAll: false,
            failType: 'DAILY_LOSS',
            totalDays,
            outcome:
              phaseObj.phaseNum === 1
                ? 'FAILED_PHASE_1'
                : phaseObj.phaseNum === 2
                  ? 'FAILED_PHASE_2'
                  : 'FAILED_FUNDED',
            equitySeries: series,
          };
        }

        if (equity <= drawdownFloor) {
          if (recordSeries) series.push(equity);
          return {
            passedPhase1,
            passedPhase2,
            passedAll: false,
            failType: 'MAX_LOSS',
            totalDays,
            outcome:
              phaseObj.phaseNum === 1
                ? 'FAILED_PHASE_1'
                : phaseObj.phaseNum === 2
                  ? 'FAILED_PHASE_2'
                  : 'FAILED_FUNDED',
            equitySeries: series,
          };
        }
      }

      if (preset.drawdownMode === 'TRAILING_EOD') {
        if (equity > hwm) {
          hwm = equity;
          drawdownFloor = Math.min(acc, hwm - maxLossDollars);
        }
      }

      const dayProfit = Math.max(0, equity - dayStartEquity);
      if (dayProfit > bestSingleDayProfit) {
        bestSingleDayProfit = dayProfit;
      }

      if (recordSeries) {
        series.push(Number(equity.toFixed(2)));
      }

      const totalProfit = equity - acc;
      const consistencyOk =
        preset.consistencyMaxDayPct <= 0 ||
        totalProfit <= 0 ||
        bestSingleDayProfit / totalProfit <= preset.consistencyMaxDayPct / 100;

      if (equity >= targetEquity && phaseDays >= preset.minTradingDays && consistencyOk) {
        phasePassed = true;
        break;
      }
    }

    if (!phasePassed) {
      return {
        passedPhase1,
        passedPhase2,
        passedAll: false,
        failType: 'TIMEOUT',
        totalDays,
        outcome: 'TIMED_OUT',
        equitySeries: series,
      };
    }

    if (phaseObj.phaseNum === 1) {
      passedPhase1 = true;
      if (preset.phase2TargetPct <= 0) {
        passedPhase2 = true;
      }
    }
    if (phaseObj.phaseNum === 2) passedPhase2 = true;
  }

  return {
    passedPhase1: true,
    passedPhase2: true,
    passedAll: true,
    failType: 'NONE',
    totalDays,
    outcome: 'PASSED_FUNDED',
    equitySeries: series,
  };
}

export function runPropFirmMonteCarlo(config: PropFirmSimConfig): PropFirmSimulationResult {
  const safePreset = sanitizePropFirmPreset(config.preset);
  const safeConfig: PropFirmSimConfig = { ...config, preset: safePreset };
  const paths = Math.max(200, Math.min(10_000, Math.round(safeConfig.numPaths || 2000)));
  const rng = createRng(safeConfig.seed);

  let p1Count = 0;
  let p2Count = 0;
  let allCount = 0;
  let failDaily = 0;
  let failMax = 0;
  let failTimeout = 0;
  let totalPassDays = 0;
  const samplePaths: PropFirmSamplePath[] = [];

  for (let i = 0; i < paths; i++) {
    const record = i < 32;
    const res = simulateSingleChallengePath(safeConfig, null, rng, record);
    if (res.passedPhase1) p1Count++;
    if (res.passedPhase2) p2Count++;
    if (res.passedAll) {
      allCount++;
      totalPassDays += res.totalDays;
    } else if (res.failType === 'DAILY_LOSS') {
      failDaily++;
    } else if (res.failType === 'MAX_LOSS') {
      failMax++;
    } else {
      failTimeout++;
    }

    if (record) {
      samplePaths.push({
        id: i + 1,
        outcome: res.outcome,
        finalEquityUsd:
          res.equitySeries[res.equitySeries.length - 1] ?? safePreset.accountSizeUsd,
        equitySeries: res.equitySeries,
      });
    }
  }

  const passAllPct = (allCount / paths) * 100;
  const payoutDollars = safePreset.accountSizeUsd * (safePreset.payoutTargetPct / 100) * 0.8;
  const expectedAttempts = passAllPct > 0.2 ? 100 / passAllPct : 99;
  const expectedTotalFeeUsd = expectedAttempts * safePreset.feeUsd;
  const expectedNetEvUsd = payoutDollars - expectedTotalFeeUsd;

  const riskLevels = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5];
  const sweepPaths = Math.min(1000, paths);
  const riskSweep: PropFirmRiskSweepPoint[] = riskLevels.map((rPct) => {
    const sRng = createRng(safeConfig.seed + Math.round(rPct * 1000));
    let sPass = 0;
    let sDaily = 0;
    let sTotal = 0;
    for (let j = 0; j < sweepPaths; j++) {
      const r = simulateSingleChallengePath(safeConfig, rPct, sRng, false);
      if (r.passedAll) sPass++;
      else if (r.failType === 'DAILY_LOSS') sDaily++;
      else if (r.failType === 'MAX_LOSS') sTotal++;
    }
    const pPct = (sPass / sweepPaths) * 100;
    const att = pPct > 0.3 ? 100 / pPct : 99;
    return {
      riskPct: rPct,
      passPct: Number(pPct.toFixed(1)),
      breachDailyPct: Number(((sDaily / sweepPaths) * 100).toFixed(1)),
      breachTotalPct: Number(((sTotal / sweepPaths) * 100).toFixed(1)),
      expectedAttempts: Number(att.toFixed(1)),
      expectedNetEvUsd: Number((payoutDollars - att * safePreset.feeUsd).toFixed(0)),
    };
  });

  const bestRisk = riskSweep.reduce(
    (best, cur) => (cur.expectedNetEvUsd > best.expectedNetEvUsd ? cur : best),
    riskSweep[0]
  );

  return {
    passPhase1Pct: Number(((p1Count / paths) * 100).toFixed(1)),
    passPhase2Pct: Number(((p2Count / paths) * 100).toFixed(1)),
    passAllPct: Number(passAllPct.toFixed(1)),
    failDailyLossPct: Number(((failDaily / paths) * 100).toFixed(1)),
    failMaxLossPct: Number(((failMax / paths) * 100).toFixed(1)),
    timeoutPct: Number(((failTimeout / paths) * 100).toFixed(1)),
    avgDaysToPass: allCount > 0 ? Number((totalPassDays / allCount).toFixed(1)) : 0,
    expectedAttempts: Number(expectedAttempts.toFixed(1)),
    expectedTotalFeeUsd: Number(expectedTotalFeeUsd.toFixed(0)),
    expectedNetEvUsd: Number(expectedNetEvUsd.toFixed(0)),
    optimalRiskPct: bestRisk.riskPct,
    samplePaths,
    riskSweep,
    computedAt: Date.now(),
  };
}

export function createInitialLiveAttempt(preset: PropFirmPreset, seed: number): PropFirmLiveAttempt {
  const snap = sanitizePropFirmPreset(preset);
  const acc = snap.accountSizeUsd;
  const maxLossDollars = acc * (snap.maxTotalLossPct / 100);
  const dailyFloor = acc - acc * (snap.maxDailyLossPct / 100);
  const drawdownFloor = acc - maxLossDollars;
  const targetUsd = acc * (1 + snap.phase1TargetPct / 100);
  return {
    seed,
    presetSnapshot: snap,
    phase: 1,
    day: 1,
    phaseDay: 1,
    equityUsd: acc,
    highWaterMarkUsd: acc,
    drawdownFloorUsd: drawdownFloor,
    dayStartEquityUsd: acc,
    dailyFloorUsd: dailyFloor,
    phaseTargetUsd: targetUsd,
    bestSingleDayProfitUsd: 0,
    consistencyPct: 0,
    outcome: 'ACTIVE',
    breachReason: null,
    trades: [],
    equityHistory: [acc],
    floorHistory: [drawdownFloor],
    dailyFloorHistory: [dailyFloor],
  };
}

export function stepLiveAttemptOneDay(
  prev: PropFirmLiveAttempt,
  config: PropFirmSimConfig
): PropFirmLiveAttempt {
  if (prev.outcome !== 'ACTIVE') return prev;
  // Evaluate against the rule snapshot locked when this live run started
  const preset = sanitizePropFirmPreset(prev.presetSnapshot || config.preset);
  const acc = preset.accountSizeUsd;
  const maxLossDollars = acc * (preset.maxTotalLossPct / 100);
  const rng = createRng(prev.seed + prev.day * 7919 + prev.phase * 104729);
  const winProb = clampNum(config.winRatePct / 100, 0.05, 0.95, 0.48);
  const avgWinR = clampNum(config.avgWinR, 0.2, 20, 1.8);
  const avgLossR = clampNum(config.avgLossR, 0.2, 20, 1.0);
  const riskPct = clampNum(config.riskPerTradePct, 0.1, 5, 0.75);
  const tradesPerDay = clampNum(config.tradesPerDay, 0.2, 20, 3);

  let equity = prev.equityUsd;
  let hwm = prev.highWaterMarkUsd;
  let drawdownFloor = prev.drawdownFloorUsd;
  let phase = prev.phase;
  const day = prev.day;
  let phaseDay = prev.phaseDay;
  let phaseTargetUsd = prev.phaseTargetUsd;
  let bestSingleDayProfitUsd = prev.bestSingleDayProfitUsd;

  const dayStartEquity = equity;
  const dailyFloor = Number((dayStartEquity - acc * (preset.maxDailyLossPct / 100)).toFixed(2));
  const newTrades: PropFirmAttemptTrade[] = [...prev.trades];
  const eqHist = [...prev.equityHistory];
  const flHist = [...prev.floorHistory];
  const dailyFlHist = [...(prev.dailyFloorHistory || [prev.dailyFloorUsd])];
  let outcome: PropFirmLiveAttempt['outcome'] = 'ACTIVE';
  let breachReason: string | null = null;

  const nTrades = samplePoisson(tradesPerDay, rng);
  for (let i = 0; i < nTrades; i++) {
    const isWin = rng() < winProb;
    const jitter = 0.85 + rng() * 0.3;
    const rMult = Number((isWin ? avgWinR * jitter : -avgLossR * jitter).toFixed(2));
    const pnl = equity * (riskPct / 100) * rMult;
    equity = Number(Math.max(0, equity + pnl).toFixed(2));

    if (preset.drawdownMode === 'TRAILING_INTRADAY' && equity > hwm) {
      hwm = equity;
      drawdownFloor = Number(Math.min(acc, hwm - maxLossDollars).toFixed(2));
    }

    let statusNote = isWin ? `WIN +${rMult.toFixed(2)}R` : `LOSS ${rMult.toFixed(2)}R`;

    if (equity <= dailyFloor) {
      outcome = 'FAILED_DAILY_LOSS';
      breachReason = `Daily Loss Limit (-${preset.maxDailyLossPct}%) an Tag ${day} (Phase ${phase === 3 ? 'Funded' : phase}) unterschritten`;
      statusNote = 'BREACH DAILY LOSS';
    } else if (equity <= drawdownFloor) {
      outcome = 'FAILED_MAX_DRAWDOWN';
      breachReason = `Max Drawdown Floor (${preset.drawdownMode}) an Tag ${day} (Phase ${phase === 3 ? 'Funded' : phase}) durchbrochen`;
      statusNote = 'BREACH MAX DD';
    }

    newTrades.push({
      tradeNum: newTrades.length + 1,
      day,
      phase,
      isWin,
      rMultiple: rMult,
      pnlUsd: Number(pnl.toFixed(2)),
      equityAfterUsd: equity,
      drawdownFloorUsd: Number(drawdownFloor.toFixed(2)),
      dailyFloorUsd: dailyFloor,
      statusNote,
    });
    eqHist.push(equity);
    flHist.push(Number(drawdownFloor.toFixed(2)));
    dailyFlHist.push(dailyFloor);

    if (outcome !== 'ACTIVE') break;
  }

  if (outcome === 'ACTIVE' && preset.drawdownMode === 'TRAILING_EOD' && equity > hwm) {
    hwm = equity;
    drawdownFloor = Number(Math.min(acc, hwm - maxLossDollars).toFixed(2));
  }

  const dayProfit = Math.max(0, equity - dayStartEquity);
  if (dayProfit > bestSingleDayProfitUsd) {
    bestSingleDayProfitUsd = Number(dayProfit.toFixed(2));
  }

  const totalPhaseProfit = equity - acc;
  let consistencyPct =
    totalPhaseProfit > 0
      ? Number(Math.min(100, (bestSingleDayProfitUsd / totalPhaseProfit) * 100).toFixed(1))
      : 0;

  const consistencyOk =
    preset.consistencyMaxDayPct <= 0 ||
    totalPhaseProfit <= 0 ||
    bestSingleDayProfitUsd / totalPhaseProfit <= preset.consistencyMaxDayPct / 100;

  let justPromoted = false;
  if (outcome === 'ACTIVE' && equity >= phaseTargetUsd && phaseDay >= preset.minTradingDays && consistencyOk) {
    if (phase === 1 && preset.phase2TargetPct > 0) {
      phase = 2;
      equity = acc;
      hwm = acc;
      drawdownFloor = acc - maxLossDollars;
      phaseTargetUsd = acc * (1 + preset.phase2TargetPct / 100);
      bestSingleDayProfitUsd = 0;
      consistencyPct = 0;
      justPromoted = true;
      eqHist.push(acc);
      flHist.push(drawdownFloor);
      dailyFlHist.push(Number((acc - acc * (preset.maxDailyLossPct / 100)).toFixed(2)));
    } else if (phase === 1 || phase === 2) {
      phase = 3;
      equity = acc;
      hwm = acc;
      drawdownFloor = acc - maxLossDollars;
      phaseTargetUsd = acc * (1 + preset.payoutTargetPct / 100);
      bestSingleDayProfitUsd = 0;
      consistencyPct = 0;
      justPromoted = true;
      eqHist.push(acc);
      flHist.push(drawdownFloor);
      dailyFlHist.push(Number((acc - acc * (preset.maxDailyLossPct / 100)).toFixed(2)));
    } else {
      outcome = 'PASSED_FUNDED';
      breachReason = `Funded Payout Target (+${preset.payoutTargetPct}%) an Phase-Tag ${phaseDay} (Gesamt Tag ${day}) erreicht!`;
    }
  } else if (outcome === 'ACTIVE' && phaseDay >= preset.maxTradingDays) {
    outcome = 'TIMED_OUT';
    breachReason = `Maximale Phasen-Dauer (${preset.maxTradingDays} Tage) in ${
      phase === 3 ? 'Funded' : `Phase ${phase}`
    } abgelaufen`;
  }

  return {
    ...prev,
    presetSnapshot: preset,
    phase,
    day: outcome === 'ACTIVE' ? day + 1 : day,
    phaseDay: outcome === 'ACTIVE' ? (justPromoted ? 1 : phaseDay + 1) : phaseDay,
    equityUsd: equity,
    highWaterMarkUsd: hwm,
    drawdownFloorUsd: Number(drawdownFloor.toFixed(2)),
    dayStartEquityUsd: equity,
    dailyFloorUsd: Number((equity - acc * (preset.maxDailyLossPct / 100)).toFixed(2)),
    phaseTargetUsd: Number(phaseTargetUsd.toFixed(2)),
    bestSingleDayProfitUsd,
    consistencyPct,
    outcome,
    breachReason,
    trades: newTrades,
    equityHistory: eqHist,
    floorHistory: flHist,
    dailyFloorHistory: dailyFlHist,
  };
}
