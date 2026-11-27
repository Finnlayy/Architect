import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  StepForward,
  Download,
  Volume2,
  ShieldCheck,
  AlertTriangle,
  Shuffle,
  Save,
  Check,
} from 'lucide-react';
import {
  BacktestResult,
  PropFirmDrawdownMode,
  PropFirmLiveAttempt,
  PropFirmPreset,
  PropFirmSimulationResult,
} from '../types/terminal';
import {
  PROP_FIRM_PRESETS,
  createInitialLiveAttempt,
  extractStrategyStatsFromBacktest,
  runPropFirmMonteCarlo,
  sanitizePropFirmPreset,
  stepLiveAttemptOneDay,
} from '../engine/propFirmSimulator';

interface PropFirmArenaPageProps {
  backtestResult: BacktestResult | null;
  activeSymbol: string;
  activeTimeframe: string;
  onVoiceBriefing: (
    firmName: string,
    challengeName: string,
    passPct: number,
    optimalRiskPct: number,
    expectedEvUsd: number
  ) => void;
}

const PROP_FIRM_STORAGE_KEY = 'omega_prop_firm_arena_settings_v1';

interface SavedPropFirmSettings {
  selectedPresetId: string;
  customPreset: PropFirmPreset;
  winRatePct: number;
  avgWinR: number;
  avgLossR: number;
  riskPerTradePct: number;
  tradesPerDay: number;
  numPaths: number;
  mcSeed: number;
  statsSourceLabel: string;
}

function loadSavedPropFirmSettings(): SavedPropFirmSettings | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PROP_FIRM_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.customPreset) return null;
    return {
      ...(parsed as SavedPropFirmSettings),
      customPreset: sanitizePropFirmPreset(parsed.customPreset as PropFirmPreset),
    };
  } catch {
    return null;
  }
}

export const PropFirmArenaPage: React.FC<PropFirmArenaPageProps> = ({
  backtestResult,
  activeSymbol,
  activeTimeframe,
  onVoiceBriefing,
}) => {
  const [initialSaved] = useState<SavedPropFirmSettings | null>(() =>
    loadSavedPropFirmSettings()
  );

  const [selectedPresetId, setSelectedPresetId] = useState<string>(
    initialSaved?.selectedPresetId || PROP_FIRM_PRESETS[0].id
  );
  const [customPreset, setCustomPreset] = useState<PropFirmPreset>(
    initialSaved?.customPreset || PROP_FIRM_PRESETS[0]
  );

  // Strategy statistics parameters (can be synced 1-click from active backtest)
  const [winRatePct, setWinRatePct] = useState<number>(initialSaved?.winRatePct ?? 48.0);
  const [avgWinR, setAvgWinR] = useState<number>(initialSaved?.avgWinR ?? 1.8);
  const [avgLossR, setAvgLossR] = useState<number>(initialSaved?.avgLossR ?? 1.0);
  const [riskPerTradePct, setRiskPerTradePct] = useState<number>(
    initialSaved?.riskPerTradePct ?? 0.75
  );
  const [tradesPerDay, setTradesPerDay] = useState<number>(initialSaved?.tradesPerDay ?? 3.0);
  const [numPaths, setNumPaths] = useState<number>(initialSaved?.numPaths ?? 5000);
  const [mcSeed, setMcSeed] = useState<number>(initialSaved?.mcSeed ?? 2026);
  const [statsSourceLabel, setStatsSourceLabel] = useState<string>(
    initialSaved?.statsSourceLabel || 'Manuelle Studio-Parameter'
  );
  const [savedNotice, setSavedNotice] = useState<boolean>(false);
  const savedTimerRef = useRef<number | null>(null);

  const [chartTab, setChartTab] = useState<'PATHS' | 'RISK_SWEEP'>('PATHS');

  // Active Step-by-Step Live Challenge Attempt
  const [liveAttempt, setLiveAttempt] = useState<PropFirmLiveAttempt>(() =>
    createInitialLiveAttempt(initialSaved?.customPreset || PROP_FIRM_PRESETS[0], 4201)
  );
  const [isAutoStepping, setIsAutoStepping] = useState<boolean>(false);

  const [hoveredTradeIdx, setHoveredTradeIdx] = useState<number | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current !== null) {
        window.clearTimeout(savedTimerRef.current);
      }
    };
  }, []);

  const updateRuleField = <K extends keyof PropFirmPreset>(
    key: K,
    val: PropFirmPreset[K]
  ) => {
    setCustomPreset((prev) => ({
      ...prev,
      [key]: val,
    }));
  };

  const handleSavePropSettings = () => {
    if (typeof window !== 'undefined') {
      try {
        const payload: SavedPropFirmSettings = {
          selectedPresetId,
          customPreset,
          winRatePct,
          avgWinR,
          avgLossR,
          riskPerTradePct,
          tradesPerDay,
          numPaths,
          mcSeed,
          statsSourceLabel,
        };
        window.localStorage.setItem(PROP_FIRM_STORAGE_KEY, JSON.stringify(payload));
      } catch {
        // ignore storage quota errors
      }
    }
    setSavedNotice(true);
    if (savedTimerRef.current !== null) {
      window.clearTimeout(savedTimerRef.current);
    }
    savedTimerRef.current = window.setTimeout(() => {
      setSavedNotice(false);
      savedTimerRef.current = null;
    }, 2000);
  };

  // Selecting a preset updates the rule editor & Monte Carlo only; active live run resets only on explicit "NEUER LAUF"
  const handleSelectPreset = (id: string) => {
    const found = PROP_FIRM_PRESETS.find((p) => p.id === id) || PROP_FIRM_PRESETS[0];
    setSelectedPresetId(found.id);
    setCustomPreset({ ...found });
  };

  const handleLoadFromBacktest = () => {
    const extracted = extractStrategyStatsFromBacktest(backtestResult);
    if (!extracted) return;
    setWinRatePct(extracted.winRatePct);
    setAvgWinR(extracted.avgWinR);
    setAvgLossR(extracted.avgLossR);
    setTradesPerDay(extracted.tradesPerDay);
    setStatsSourceLabel(extracted.sourceNote);
  };

  const simConfig = useMemo(
    () => ({
      preset: customPreset,
      winRatePct,
      avgWinR,
      avgLossR,
      riskPerTradePct,
      tradesPerDay,
      numPaths,
      seed: mcSeed,
    }),
    [customPreset, winRatePct, avgWinR, avgLossR, riskPerTradePct, tradesPerDay, numPaths, mcSeed]
  );

  const simResult: PropFirmSimulationResult = useMemo(
    () => runPropFirmMonteCarlo(simConfig),
    [simConfig]
  );

  // Auto-step timer for live challenge playback in livestream
  useEffect(() => {
    if (!isAutoStepping || liveAttempt.outcome !== 'ACTIVE') {
      if (isAutoStepping && liveAttempt.outcome !== 'ACTIVE') {
        setIsAutoStepping(false);
      }
      return;
    }
    const timer = window.setInterval(() => {
      setLiveAttempt((prev) => stepLiveAttemptOneDay(prev, simConfig));
    }, 450);
    return () => window.clearInterval(timer);
  }, [isAutoStepping, liveAttempt.outcome, simConfig]);

  const handleNewLiveAttempt = () => {
    setIsAutoStepping(false);
    setHoveredTradeIdx(null);
    setLiveAttempt(
      createInitialLiveAttempt(customPreset, Math.floor(Math.random() * 900000) + 1000)
    );
  };

  // Detect whether current sidebar rules differ from the active run's locked snapshot
  const liveRulesOutOfSync = useMemo(() => {
    const snap = liveAttempt.presetSnapshot;
    if (!snap) return false;
    return (
      snap.accountSizeUsd !== customPreset.accountSizeUsd ||
      snap.phase1TargetPct !== customPreset.phase1TargetPct ||
      snap.phase2TargetPct !== customPreset.phase2TargetPct ||
      snap.maxDailyLossPct !== customPreset.maxDailyLossPct ||
      snap.maxTotalLossPct !== customPreset.maxTotalLossPct ||
      snap.drawdownMode !== customPreset.drawdownMode ||
      snap.minTradingDays !== customPreset.minTradingDays ||
      snap.maxTradingDays !== customPreset.maxTradingDays ||
      snap.consistencyMaxDayPct !== customPreset.consistencyMaxDayPct ||
      snap.payoutTargetPct !== customPreset.payoutTargetPct
    );
  }, [liveAttempt.presetSnapshot, customPreset]);

  // 1. Monte Carlo Day-Horizon Chart Bounds (Strictly Trading-Day X-Axis)
  const mcChartBounds = useMemo(() => {
    const acc = customPreset.accountSizeUsd;
    let minEq = acc * (1 - customPreset.maxTotalLossPct / 100) * 0.992;
    let maxEq = acc * (1 + customPreset.phase1TargetPct / 100) * 1.012;
    let maxDays = 10;

    for (const sp of simResult.samplePaths) {
      maxDays = Math.max(maxDays, sp.equitySeries.length);
      for (const v of sp.equitySeries) {
        if (v < minEq) minEq = v;
        if (v > maxEq) maxEq = v;
      }
    }
    return { minEq, maxEq, maxDays };
  }, [simResult.samplePaths, customPreset]);

  const MC_W = 760;
  const MC_H = 195;
  const PAD_L = 12;
  const PAD_R = 76;
  const PAD_T = 14;
  const PAD_B = 22;
  const MC_PW = MC_W - PAD_L - PAD_R;
  const MC_PH = MC_H - PAD_T - PAD_B;

  const yForMcEq = (eq: number) => {
    const ratio =
      (eq - mcChartBounds.minEq) /
      Math.max(1, mcChartBounds.maxEq - mcChartBounds.minEq);
    return PAD_T + MC_PH - ratio * MC_PH;
  };
  const xForMcDay = (dayIdx: number, total: number) =>
    PAD_L + (total <= 1 ? 0 : (dayIdx / (total - 1)) * MC_PW);

  // 2. Separate Live Trade-Step Chart Bounds (Strictly Executed-Trade X-Axis)
  const liveSnap = liveAttempt.presetSnapshot || customPreset;
  const liveStepBounds = useMemo(() => {
    const acc = liveSnap.accountSizeUsd;
    let minEq = Math.min(
      acc * (1 - liveSnap.maxTotalLossPct / 100),
      liveAttempt.drawdownFloorUsd,
      liveAttempt.dailyFloorUsd
    );
    let maxEq = Math.max(acc * 1.005, liveAttempt.phaseTargetUsd);

    for (const v of liveAttempt.equityHistory) {
      if (v < minEq) minEq = v;
      if (v > maxEq) maxEq = v;
    }
    for (const v of liveAttempt.floorHistory) {
      if (v < minEq) minEq = v;
      if (v > maxEq) maxEq = v;
    }
    const pad = Math.max(100, (maxEq - minEq) * 0.06);
    return {
      minEq: minEq - pad,
      maxEq: maxEq + pad,
      totalSteps: Math.max(2, liveAttempt.equityHistory.length),
    };
  }, [liveAttempt, liveSnap]);

  const LIVE_W = 760;
  const LIVE_H = 142;
  const LIVE_PAD_T = 12;
  const LIVE_PAD_B = 20;
  const LIVE_PH = LIVE_H - LIVE_PAD_T - LIVE_PAD_B;
  const LIVE_PW = LIVE_W - PAD_L - PAD_R;

  const yForLiveEq = (eq: number) => {
    const ratio =
      (eq - liveStepBounds.minEq) /
      Math.max(1, liveStepBounds.maxEq - liveStepBounds.minEq);
    return LIVE_PAD_T + LIVE_PH - ratio * LIVE_PH;
  };
  const xForLiveStep = (stepIdx: number) =>
    PAD_L + (liveStepBounds.totalSteps <= 1 ? 0 : (stepIdx / (liveStepBounds.totalSteps - 1)) * LIVE_PW);

  const liveTradeStepMeta = useMemo(() => {
    let transitions = 0;
    const stepIndices: number[] = [];
    const promoResetIndices: Array<{ idx: number; toPhase: number }> = [];
    for (let i = 0; i < liveAttempt.trades.length; i++) {
      const tr = liveAttempt.trades[i];
      if (i > 0 && tr.phase !== liveAttempt.trades[i - 1].phase) {
        transitions += 1;
        promoResetIndices.push({ idx: i + transitions, toPhase: tr.phase });
      }
      stepIndices.push(i + 1 + transitions);
    }
    if (
      liveAttempt.trades.length > 0 &&
      liveAttempt.phase > liveAttempt.trades[liveAttempt.trades.length - 1].phase
    ) {
      promoResetIndices.push({
        idx: liveAttempt.trades.length + 1 + transitions,
        toPhase: liveAttempt.phase,
      });
    }
    return { stepIndices, promoResetIndices };
  }, [liveAttempt.trades, liveAttempt.phase]);

  const drawdownModeLabel = (mode: PropFirmDrawdownMode) =>
    mode === 'STATIC'
      ? 'Static Balance'
      : mode === 'TRAILING_INTRADAY'
      ? 'Trailing Intraday'
      : 'Trailing EOD';

  const expectancyR =
    (winRatePct / 100) * avgWinR - (1 - winRatePct / 100) * avgLossR;

  const ruleConflictWarning =
    customPreset.maxDailyLossPct > customPreset.maxTotalLossPct
      ? 'Hinweis: Daily Loss % ist größer als Max Total Loss %.'
      : customPreset.minTradingDays > customPreset.maxTradingDays
      ? 'Hinweis: Min. Handelstage überschreiten Max. Handelstage.'
      : null;

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden bg-[#07090E]">
      {/* Left Column: Prop Firm Rule Config & Strategy Parameters */}
      <aside className="w-[340px] xl:w-[370px] bg-[#0B0F15] border-r border-[#263042] flex flex-col min-h-0 overflow-y-auto shrink-0 p-3 space-y-3">
        <div className="flex items-center justify-between border-b border-[#1E2634] pb-2">
          <div>
            <div className="text-[11px] font-bold tracking-wider uppercase text-[#F59E0B]">
              PROP FIRM ARENA · LUXALGO SIM ENGINE
            </div>
            <div className="text-[10px] font-mono text-[#8B95A5]">
              Monte-Carlo &amp; Live-Challenge-Tester ({numPaths.toLocaleString('de-DE')} Pfade)
            </div>
          </div>
          <button
            type="button"
            onClick={() =>
              onVoiceBriefing(
                customPreset.firmName,
                customPreset.challengeName,
                simResult.passAllPct,
                simResult.optimalRiskPct,
                simResult.expectedNetEvUsd
              )
            }
            title="Live Voice-Briefing dieser Prop-Firm-Auswertung abspielen"
            className="px-2 py-1 border border-[#F59E0B]/60 bg-[#F59E0B]/15 text-[#F59E0B] text-[10px] font-mono font-bold flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            <Volume2 className="w-3 h-3" />
            <span>BRIEFING</span>
          </button>
        </div>

        {/* Preset Selector */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-mono uppercase text-[#8B95A5] block">
            Prop Firm Regelwerk
          </label>
          <select
            value={selectedPresetId}
            onChange={(e) => handleSelectPreset(e.target.value)}
            className="w-full bg-[#07090E] border border-[#263042] px-2.5 py-1.5 text-xs font-mono text-[#E6EDF3]"
          >
            {PROP_FIRM_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.firmName} — {p.challengeName} (${(p.accountSizeUsd / 1000).toFixed(0)}K · Fee ${p.feeUsd})
              </option>
            ))}
          </select>

          <div className="grid grid-cols-3 gap-1.5 text-[10px] font-mono tabular-nums">
            <div className="p-1.5 bg-[#07090E] border border-[#1E2634]">
              <div className="text-[#8B95A5]">Phase 1 / 2</div>
              <div className="text-[#089981] font-bold">
                +{customPreset.phase1TargetPct}% /{' '}
                {customPreset.phase2TargetPct > 0 ? `+${customPreset.phase2TargetPct}%` : '1-Step'}
              </div>
            </div>
            <div className="p-1.5 bg-[#07090E] border border-[#1E2634]">
              <div className="text-[#8B95A5]">Daily / Max</div>
              <div className="text-[#F23645] font-bold">
                -{customPreset.maxDailyLossPct}% / -{customPreset.maxTotalLossPct}%
              </div>
            </div>
            <div className="p-1.5 bg-[#07090E] border border-[#1E2634]">
              <div className="text-[#8B95A5]">Drawdown Typ</div>
              <div className="text-[#F59E0B] font-bold truncate">
                {drawdownModeLabel(customPreset.drawdownMode)}
              </div>
            </div>
          </div>
        </div>

        {/* Full Editable Prop Firm Rules Grid */}
        <div className="pt-1.5 border-t border-[#1E2634] space-y-2">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-[#E6EDF3]">
            <span>Editierbare Challenge-Regeln</span>
            <span className="text-[#8B95A5] font-normal">
              {customPreset.phase2TargetPct > 0 ? '2-Step' : '1-Step'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono tabular-nums">
            <label className="space-y-0.5">
              <span className="text-[#8B95A5] block">Konto ($)</span>
              <input
                type="number"
                min={1000}
                max={5000000}
                step={5000}
                value={customPreset.accountSizeUsd}
                onChange={(e) =>
                  updateRuleField('accountSizeUsd', Number(e.target.value) || 10000)
                }
                className="w-full bg-[#07090E] border border-[#263042] px-2 py-1 text-[#E6EDF3]"
              />
            </label>
            <label className="space-y-0.5">
              <span className="text-[#8B95A5] block">Gebühr ($)</span>
              <input
                type="number"
                min={0}
                max={50000}
                step={10}
                value={customPreset.feeUsd}
                onChange={(e) => updateRuleField('feeUsd', Math.max(0, Number(e.target.value) || 0))}
                className="w-full bg-[#07090E] border border-[#263042] px-2 py-1 text-[#E6EDF3]"
              />
            </label>
            <label className="space-y-0.5">
              <span className="text-[#8B95A5] block">Phase 1 Ziel (%)</span>
              <input
                type="number"
                min={0.5}
                max={50}
                step={0.5}
                value={customPreset.phase1TargetPct}
                onChange={(e) =>
                  updateRuleField('phase1TargetPct', Math.max(0.5, Number(e.target.value) || 0.5))
                }
                className="w-full bg-[#07090E] border border-[#263042] px-2 py-1 text-[#089981]"
              />
            </label>
            <label className="space-y-0.5">
              <span className="text-[#8B95A5] block">Phase 2 % (0=1-Step)</span>
              <input
                type="number"
                min={0}
                max={50}
                step={0.5}
                value={customPreset.phase2TargetPct}
                onChange={(e) =>
                  updateRuleField('phase2TargetPct', Math.max(0, Number(e.target.value) || 0))
                }
                className="w-full bg-[#07090E] border border-[#263042] px-2 py-1 text-[#089981]"
              />
            </label>
            <label className="space-y-0.5">
              <span className="text-[#8B95A5] block">Daily Loss (%)</span>
              <input
                type="number"
                min={0.5}
                max={50}
                step={0.25}
                value={customPreset.maxDailyLossPct}
                onChange={(e) =>
                  updateRuleField('maxDailyLossPct', Math.max(0.5, Number(e.target.value) || 0.5))
                }
                className="w-full bg-[#07090E] border border-[#263042] px-2 py-1 text-[#F23645]"
              />
            </label>
            <label className="space-y-0.5">
              <span className="text-[#8B95A5] block">Max Total DD (%)</span>
              <input
                type="number"
                min={0.5}
                max={80}
                step={0.5}
                value={customPreset.maxTotalLossPct}
                onChange={(e) =>
                  updateRuleField('maxTotalLossPct', Math.max(0.5, Number(e.target.value) || 0.5))
                }
                className="w-full bg-[#07090E] border border-[#263042] px-2 py-1 text-[#F23645]"
              />
            </label>
            <label className="space-y-0.5">
              <span className="text-[#8B95A5] block">Min. Handelstage</span>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={customPreset.minTradingDays}
                onChange={(e) =>
                  updateRuleField('minTradingDays', Math.max(0, Math.round(Number(e.target.value) || 0)))
                }
                className="w-full bg-[#07090E] border border-[#263042] px-2 py-1 text-[#E6EDF3]"
              />
            </label>
            <label className="space-y-0.5">
              <span className="text-[#8B95A5] block">Max. Handelstage</span>
              <input
                type="number"
                min={1}
                max={365}
                step={1}
                value={customPreset.maxTradingDays}
                onChange={(e) =>
                  updateRuleField('maxTradingDays', Math.max(1, Math.round(Number(e.target.value) || 1)))
                }
                className="w-full bg-[#07090E] border border-[#263042] px-2 py-1 text-[#E6EDF3]"
              />
            </label>
            <label className="space-y-0.5">
              <span className="text-[#8B95A5] block">Consistency % (0=Aus)</span>
              <input
                type="number"
                min={0}
                max={100}
                step={5}
                value={customPreset.consistencyMaxDayPct}
                onChange={(e) =>
                  updateRuleField(
                    'consistencyMaxDayPct',
                    Math.max(0, Math.min(100, Number(e.target.value) || 0))
                  )
                }
                className="w-full bg-[#07090E] border border-[#263042] px-2 py-1 text-[#F59E0B]"
              />
            </label>
            <label className="space-y-0.5">
              <span className="text-[#8B95A5] block">Funded Payout (%)</span>
              <input
                type="number"
                min={0.5}
                max={50}
                step={0.5}
                value={customPreset.payoutTargetPct}
                onChange={(e) =>
                  updateRuleField('payoutTargetPct', Math.max(0.5, Number(e.target.value) || 0.5))
                }
                className="w-full bg-[#07090E] border border-[#263042] px-2 py-1 text-[#00E5FF]"
              />
            </label>
            <label className="space-y-0.5">
              <span className="text-[#8B95A5] block">Drawdown Mechanik</span>
              <select
                value={customPreset.drawdownMode}
                onChange={(e) =>
                  updateRuleField('drawdownMode', e.target.value as PropFirmDrawdownMode)
                }
                className="w-full bg-[#07090E] border border-[#263042] px-2 py-1 text-[#E6EDF3]"
              >
                <option value="STATIC">Static Balance</option>
                <option value="TRAILING_EOD">Trailing EOD</option>
                <option value="TRAILING_INTRADAY">Trailing Intraday</option>
              </select>
            </label>
            <label className="space-y-0.5">
              <span className="text-[#8B95A5] block">Pfade (Monte Carlo)</span>
              <select
                value={numPaths}
                onChange={(e) => setNumPaths(Number(e.target.value))}
                className="w-full bg-[#07090E] border border-[#263042] px-2 py-1 text-[#E6EDF3]"
              >
                <option value={2000}>2.000 Pfade</option>
                <option value={5000}>5.000 Pfade</option>
                <option value={10000}>10.000 Pfade</option>
              </select>
            </label>
          </div>
          {ruleConflictWarning && (
            <div className="px-2 py-1 bg-[#231B0E] border border-[#F59E0B]/50 text-[10px] font-mono text-[#F59E0B]">
              {ruleConflictWarning}
            </div>
          )}
        </div>

        {/* Strategy Stats Import from Active Terminal Backtest */}
        <div className="pt-2 border-t border-[#1E2634] space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#E6EDF3]">
              Strategie-Statistik
            </span>
            <button
              type="button"
              disabled={!backtestResult || backtestResult.trades.length === 0}
              onClick={handleLoadFromBacktest}
              className={`px-2 py-1 border text-[10px] font-mono font-bold flex items-center gap-1 whitespace-nowrap ${
                backtestResult && backtestResult.trades.length > 0
                  ? 'border-[#00E5FF]/60 bg-[#00E5FF]/15 text-[#00E5FF] hover:bg-[#00E5FF]/25'
                  : 'border-[#1E2634] text-[#566173] cursor-not-allowed'
              }`}
            >
              <Download className="w-2.5 h-2.5" />
              <span>BACKTEST-STATS LADEN</span>
            </button>
          </div>
          <div className="text-[10px] font-mono text-[#8B95A5] truncate">
            Quelle: <span className="text-[#E6EDF3]">{statsSourceLabel}</span>
            {' · '}
            {activeSymbol} ({activeTimeframe})
          </div>

          {/* Sliders / Numeric Inputs */}
          <div className="space-y-2 text-[11px] font-mono tabular-nums">
            <div>
              <div className="flex justify-between text-[#8B95A5]">
                <span>Winrate</span>
                <span className="text-[#E6EDF3] font-bold">{winRatePct.toFixed(1)}%</span>
              </div>
              <input
                type="range"
                min={20}
                max={80}
                step={0.5}
                value={winRatePct}
                onChange={(e) => setWinRatePct(Number(e.target.value))}
                className="w-full accent-[#089981]"
              />
            </div>

            <div>
              <div className="flex justify-between text-[#8B95A5]">
                <span>Avg Win R-Multiple</span>
                <span className="text-[#089981] font-bold">{avgWinR.toFixed(2)}R</span>
              </div>
              <input
                type="range"
                min={0.5}
                max={4.5}
                step={0.05}
                value={avgWinR}
                onChange={(e) => setAvgWinR(Number(e.target.value))}
                className="w-full accent-[#089981]"
              />
            </div>

            <div>
              <div className="flex justify-between text-[#8B95A5]">
                <span>Risiko pro Trade</span>
                <span className="text-[#F59E0B] font-bold">{riskPerTradePct.toFixed(2)}%</span>
              </div>
              <input
                type="range"
                min={0.25}
                max={2.5}
                step={0.05}
                value={riskPerTradePct}
                onChange={(e) => setRiskPerTradePct(Number(e.target.value))}
                className="w-full accent-[#F59E0B]"
              />
            </div>

            <div>
              <div className="flex justify-between text-[#8B95A5]">
                <span>Trades / Tag (Poisson Ø)</span>
                <span className="text-[#E6EDF3] font-bold">{tradesPerDay.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min={1}
                max={10}
                step={0.5}
                value={tradesPerDay}
                onChange={(e) => setTradesPerDay(Number(e.target.value))}
                className="w-full accent-[#00E5FF]"
              />
            </div>

            <div className="p-2 bg-[#07090E] border border-[#1E2634] flex items-center justify-between text-[10px]">
              <span className="text-[#8B95A5]">Erwartungswert / Trade</span>
              <span className={expectancyR >= 0 ? 'text-[#089981] font-bold' : 'text-[#F23645] font-bold'}>
                {expectancyR >= 0 ? '+' : ''}
                {expectancyR.toFixed(3)}R
              </span>
            </div>
          </div>
        </div>

        {/* Save & Monte Carlo Seed Shuffle Actions */}
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={handleSavePropSettings}
            className={`w-full py-1.5 border text-[10px] font-mono font-bold flex items-center justify-center gap-1.5 transition-colors ${
              savedNotice
                ? 'border-[#10B981] bg-[#10B981]/20 text-[#10B981]'
                : 'border-[#F59E0B]/60 bg-[#F59E0B]/10 hover:bg-[#F59E0B]/20 text-[#F59E0B]'
            }`}
          >
            {savedNotice ? <Check className="w-3 h-3" /> : <Save className="w-3 h-3" />}
            <span>{savedNotice ? 'WERTE GESPEICHERT' : 'EINGESTELLTE WERTE SPEICHERN'}</span>
          </button>

          <button
            type="button"
            onClick={() => setMcSeed((s) => s + 17)}
            className="w-full py-1.5 bg-[#07090E] hover:bg-[#131924] border border-[#263042] text-[#E6EDF3] text-[10px] font-mono font-bold flex items-center justify-center gap-1.5"
          >
            <Shuffle className="w-3 h-3 text-[#00E5FF]" />
            <span>MONTE-CARLO NEU WÜRFELN (SEED #{mcSeed})</span>
          </button>
        </div>
      </aside>

      {/* Right Stage: KPIs + Path/Risk-Sweep Chart + Active Challenge Live Tester */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        {/* Top 5 KPI Strip */}
        <div className="grid grid-cols-5 border-b border-[#263042] bg-[#0B0F15] font-mono tabular-nums shrink-0 divide-x divide-[#1E2634]">
          <div className="px-3 py-2">
            <div className="text-[9px] text-[#8B95A5] uppercase">Pass Probability (Funded)</div>
            <div
              className={`text-lg font-bold ${
                simResult.passAllPct >= 30
                  ? 'text-[#089981]'
                  : simResult.passAllPct >= 15
                  ? 'text-[#F59E0B]'
                  : 'text-[#F23645]'
              }`}
            >
              {simResult.passAllPct.toFixed(1)}%
            </div>
            <div className="text-[9px] text-[#8B95A5]">
              {customPreset.phase2TargetPct > 0
                ? `P1: ${simResult.passPhase1Pct}% · P2: ${simResult.passPhase2Pct}%`
                : `P1: ${simResult.passPhase1Pct}% · 1-Step Challenge`}
            </div>
          </div>

          <div className="px-3 py-2">
            <div className="text-[9px] text-[#8B95A5] uppercase">Breach Risiko</div>
            <div className="text-lg font-bold text-[#F23645]">
              {(simResult.failDailyLossPct + simResult.failMaxLossPct).toFixed(1)}%
            </div>
            <div className="text-[9px] text-[#8B95A5]">
              Daily {simResult.failDailyLossPct}% · MaxDD {simResult.failMaxLossPct}%
            </div>
          </div>

          <div className="px-3 py-2">
            <div className="text-[9px] text-[#8B95A5] uppercase">Erw. Versuche / Dauer</div>
            <div className="text-lg font-bold text-[#E6EDF3]">
              {simResult.expectedAttempts.toFixed(1)}×
            </div>
            <div className="text-[9px] text-[#8B95A5]">
              Ø {simResult.avgDaysToPass > 0 ? `${simResult.avgDaysToPass} Handelstage` : '—'}
            </div>
          </div>

          <div className="px-3 py-2">
            <div className="text-[9px] text-[#8B95A5] uppercase">Erw. Netto-EV</div>
            <div
              className={`text-lg font-bold ${
                simResult.expectedNetEvUsd >= 0 ? 'text-[#089981]' : 'text-[#F23645]'
              }`}
            >
              {simResult.expectedNetEvUsd >= 0 ? '+' : '-'}$
              {Math.abs(simResult.expectedNetEvUsd).toLocaleString('en-US')}
            </div>
            <div className="text-[9px] text-[#8B95A5]">
              Ø Gebühren: ${simResult.expectedTotalFeeUsd.toLocaleString('en-US')}
            </div>
          </div>

          <div className="px-3 py-2">
            <div className="text-[9px] text-[#8B95A5] uppercase">Optimal Risk / Trade</div>
            <div className="text-lg font-bold text-[#00E5FF]">
              {simResult.optimalRiskPct.toFixed(2)}%
            </div>
            <button
              type="button"
              onClick={() => setRiskPerTradePct(simResult.optimalRiskPct)}
              className="text-[9px] text-[#F59E0B] hover:underline"
            >
              Auf {simResult.optimalRiskPct.toFixed(2)}% übernehmen
            </button>
          </div>
        </div>

        {/* Upper Chart Section: Monte Carlo Trading-Day Cloud OR Risk Sweep */}
        <div className="flex flex-col border-b border-[#263042] bg-[#07090E] shrink-0">
          <div className="px-3 py-1.5 bg-[#090D14] border-b border-[#1E2634] flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setChartTab('PATHS')}
                className={`px-2.5 py-1 text-[10px] font-mono font-bold border whitespace-nowrap ${
                  chartTab === 'PATHS'
                    ? 'border-[#00E5FF] bg-[#00E5FF]/15 text-[#00E5FF]'
                    : 'border-[#1E2634] text-[#8B95A5] hover:text-[#E6EDF3]'
                }`}
              >
                MONTE CARLO PFADE (TAGESBASIS)
              </button>
              <button
                type="button"
                onClick={() => setChartTab('RISK_SWEEP')}
                className={`px-2.5 py-1 text-[10px] font-mono font-bold border whitespace-nowrap ${
                  chartTab === 'RISK_SWEEP'
                    ? 'border-[#F59E0B] bg-[#F59E0B]/15 text-[#F59E0B]'
                    : 'border-[#1E2634] text-[#8B95A5] hover:text-[#E6EDF3]'
                }`}
              >
                RISIKO-OPTIMIERUNG (0.25% – 2.50%)
              </button>
            </div>
            <div className="flex items-center gap-3 text-[10px] font-mono tabular-nums text-[#8B95A5]">
              {chartTab === 'PATHS' && (
                <span className="hidden lg:inline">
                  <span className="text-[#089981]">Passed</span> ·{' '}
                  <span className="text-[#F59E0B]">Timeout</span> ·{' '}
                  <span className="text-[#F23645]">Breach</span>
                </span>
              )}
              <span>
                Konto: ${customPreset.accountSizeUsd.toLocaleString('en-US')} · Target +
                {customPreset.phase1TargetPct}% · MaxDD -{customPreset.maxTotalLossPct}% (
                {customPreset.drawdownMode})
              </span>
            </div>
          </div>

          {chartTab === 'PATHS' ? (
            <div className="h-[195px] w-full p-1">
              <svg viewBox={`0 0 ${MC_W} ${MC_H}`} className="w-full h-full">
                {/* Account Baseline */}
                <line
                  x1={PAD_L}
                  y1={yForMcEq(customPreset.accountSizeUsd)}
                  x2={MC_W - PAD_R}
                  y2={yForMcEq(customPreset.accountSizeUsd)}
                  stroke="#334155"
                  strokeDasharray="3 3"
                  strokeWidth="1"
                />
                {/* Phase 1 Profit Target Line */}
                <line
                  x1={PAD_L}
                  y1={yForMcEq(
                    customPreset.accountSizeUsd * (1 + customPreset.phase1TargetPct / 100)
                  )}
                  x2={MC_W - PAD_R}
                  y2={yForMcEq(
                    customPreset.accountSizeUsd * (1 + customPreset.phase1TargetPct / 100)
                  )}
                  stroke="#089981"
                  strokeDasharray="4 2"
                  strokeWidth="1.2"
                />
                <text
                  x={MC_W - PAD_R + 4}
                  y={
                    yForMcEq(
                      customPreset.accountSizeUsd * (1 + customPreset.phase1TargetPct / 100)
                    ) + 3
                  }
                  fill="#089981"
                  fontSize="9"
                  fontFamily="JetBrains Mono, monospace"
                >
                  +${((customPreset.accountSizeUsd * customPreset.phase1TargetPct) / 100).toFixed(0)}
                </text>

                {/* Max Drawdown Floor Line */}
                <line
                  x1={PAD_L}
                  y1={yForMcEq(
                    customPreset.accountSizeUsd * (1 - customPreset.maxTotalLossPct / 100)
                  )}
                  x2={MC_W - PAD_R}
                  y2={yForMcEq(
                    customPreset.accountSizeUsd * (1 - customPreset.maxTotalLossPct / 100)
                  )}
                  stroke="#F23645"
                  strokeDasharray="4 2"
                  strokeWidth="1.2"
                />
                <text
                  x={MC_W - PAD_R + 4}
                  y={
                    yForMcEq(
                      customPreset.accountSizeUsd * (1 - customPreset.maxTotalLossPct / 100)
                    ) + 3
                  }
                  fill="#F23645"
                  fontSize="9"
                  fontFamily="JetBrains Mono, monospace"
                >
                  -${((customPreset.accountSizeUsd * customPreset.maxTotalLossPct) / 100).toFixed(0)}
                </text>

                {/* Monte Carlo Cloud Trajectories (Day X-axis) */}
                {simResult.samplePaths.map((sp) => {
                  if (sp.equitySeries.length < 2) return null;
                  const pts = sp.equitySeries
                    .map(
                      (val, idx) =>
                        `${xForMcDay(idx, mcChartBounds.maxDays).toFixed(1)},${yForMcEq(
                          val
                        ).toFixed(1)}`
                    )
                    .join(' ');
                  const stroke =
                    sp.outcome === 'PASSED_FUNDED'
                      ? '#089981'
                      : sp.outcome === 'TIMED_OUT'
                      ? '#F59E0B'
                      : '#F23645';
                  return (
                    <polyline
                      key={`mc-path-${sp.id}`}
                      fill="none"
                      stroke={stroke}
                      strokeOpacity={sp.outcome === 'PASSED_FUNDED' ? 0.5 : 0.24}
                      strokeWidth="1"
                      points={pts}
                    />
                  );
                })}

                {/* Day Axis Markers */}
                <text
                  x={PAD_L}
                  y={MC_H - 5}
                  fill="#64748B"
                  fontSize="8.5"
                  fontFamily="JetBrains Mono, monospace"
                >
                  Tag 0
                </text>
                <text
                  x={MC_W - PAD_R}
                  y={MC_H - 5}
                  textAnchor="end"
                  fill="#64748B"
                  fontSize="8.5"
                  fontFamily="JetBrains Mono, monospace"
                >
                  Tag {Math.max(1, mcChartBounds.maxDays - 1)}
                </text>
              </svg>
            </div>
          ) : (
            <div className="h-[195px] overflow-y-auto p-3">
              <table className="w-full text-left border-collapse font-mono tabular-nums text-[11px]">
                <thead>
                  <tr className="border-b border-[#263042] text-[10px] text-[#8B95A5]">
                    <th className="py-1.5 pr-3">RISK / TRADE</th>
                    <th className="py-1.5 pr-3 text-right">PASS %</th>
                    <th className="py-1.5 pr-3 text-right">DAILY BREACH</th>
                    <th className="py-1.5 pr-3 text-right">MAX DD BREACH</th>
                    <th className="py-1.5 pr-3 text-right">ERW. VERSUCHE</th>
                    <th className="py-1.5 text-right">NETTO EV ($)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E2634]">
                  {simResult.riskSweep.map((row) => {
                    const isOptimal = row.riskPct === simResult.optimalRiskPct;
                    const isSelected = Math.abs(row.riskPct - riskPerTradePct) < 0.03;
                    return (
                      <tr
                        key={row.riskPct}
                        onClick={() => setRiskPerTradePct(row.riskPct)}
                        className={`cursor-pointer ${
                          isSelected
                            ? 'bg-[#00E5FF]/15'
                            : isOptimal
                            ? 'bg-[#089981]/10'
                            : 'hover:bg-[#131924]'
                        }`}
                      >
                        <td className="py-1.5 pr-3 font-bold text-[#E6EDF3]">
                          {row.riskPct.toFixed(2)}%
                          {isOptimal && (
                            <span className="ml-2 text-[9px] text-[#089981]">OPTIMAL</span>
                          )}
                        </td>
                        <td className="py-1.5 pr-3 text-right font-bold text-[#089981]">
                          {row.passPct.toFixed(1)}%
                        </td>
                        <td className="py-1.5 pr-3 text-right text-[#F59E0B]">
                          {row.breachDailyPct.toFixed(1)}%
                        </td>
                        <td className="py-1.5 pr-3 text-right text-[#F23645]">
                          {row.breachTotalPct.toFixed(1)}%
                        </td>
                        <td className="py-1.5 pr-3 text-right text-[#E6EDF3]">
                          {row.expectedAttempts.toFixed(1)}×
                        </td>
                        <td
                          className={`py-1.5 text-right font-bold ${
                            row.expectedNetEvUsd >= 0 ? 'text-[#089981]' : 'text-[#F23645]'
                          }`}
                        >
                          {row.expectedNetEvUsd >= 0 ? '+' : '-'}$
                          {Math.abs(row.expectedNetEvUsd).toLocaleString('en-US')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Lower Half: Separate Live Trade-Step Chart + Interactive Challenge Ledger */}
        <div className="flex-1 flex flex-col min-h-0 bg-[#0B0F15]">
          <div className="px-3 py-1.5 bg-[#090D14] border-b border-[#263042] flex items-center justify-between gap-2 flex-wrap shrink-0">
            <div className="flex items-center gap-2.5 font-mono tabular-nums text-[11px] flex-wrap">
              <span className="font-bold text-[#00E5FF] flex items-center gap-1.5">
                {liveAttempt.outcome === 'PASSED_FUNDED' ? (
                  <ShieldCheck className="w-3.5 h-3.5 text-[#089981]" />
                ) : liveAttempt.outcome.startsWith('FAILED') || liveAttempt.outcome === 'TIMED_OUT' ? (
                  <AlertTriangle className="w-3.5 h-3.5 text-[#F23645]" />
                ) : null}
                LIVE TRADE-STEP TESTLAUF #{liveAttempt.seed}
              </span>
              <span className="text-[#8B95A5]">
                Phase{' '}
                <strong className="text-[#E6EDF3]">
                  {liveAttempt.phase === 3 ? 'FUNDED' : `${liveAttempt.phase}`}
                </strong>
              </span>
              <span className="text-[#8B95A5]">
                Phase-Tag{' '}
                <strong className="text-[#E6EDF3]">
                  {liveAttempt.phaseDay}/{liveSnap.maxTradingDays}
                </strong>{' '}
                <span className="text-[#566173]">(Min {liveSnap.minTradingDays})</span>
              </span>
              <span className="text-[#8B95A5]">
                Equity{' '}
                <strong
                  className={
                    liveAttempt.equityUsd >= liveSnap.accountSizeUsd
                      ? 'text-[#089981]'
                      : 'text-[#F23645]'
                  }
                >
                  ${liveAttempt.equityUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </strong>
              </span>
              <span className="text-[#8B95A5] hidden xl:inline">
                DD-Floor{' '}
                <strong className="text-[#F59E0B]">
                  ${liveAttempt.drawdownFloorUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </strong>
              </span>
              <span className="text-[#8B95A5] hidden xl:inline">
                Ziel{' '}
                <strong className="text-[#089981]">
                  ${liveAttempt.phaseTargetUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </strong>
              </span>
              {liveSnap.consistencyMaxDayPct > 0 && (
                <span className="text-[#8B95A5] hidden lg:inline">
                  Cons.{' '}
                  <strong
                    className={
                      liveAttempt.consistencyPct > liveSnap.consistencyMaxDayPct
                        ? 'text-[#F59E0B]'
                        : 'text-[#089981]'
                    }
                  >
                    {liveAttempt.consistencyPct.toFixed(1)}%
                  </strong>
                  /{liveSnap.consistencyMaxDayPct}%
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                disabled={liveAttempt.outcome !== 'ACTIVE'}
                onClick={() => setIsAutoStepping((v) => !v)}
                className={`px-2.5 py-1 border text-[10px] font-mono font-bold flex items-center gap-1 whitespace-nowrap ${
                  isAutoStepping
                    ? 'border-[#F59E0B] bg-[#F59E0B]/15 text-[#F59E0B]'
                    : 'border-[#089981] bg-[#089981]/15 text-[#089981] disabled:opacity-40'
                }`}
              >
                {isAutoStepping ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                <span>{isAutoStepping ? 'PAUSE' : 'AUTO-TEST'}</span>
              </button>
              <button
                type="button"
                disabled={liveAttempt.outcome !== 'ACTIVE'}
                onClick={() =>
                  setLiveAttempt((prev) => stepLiveAttemptOneDay(prev, simConfig))
                }
                className="px-2.5 py-1 border border-[#263042] bg-[#07090E] hover:border-[#00E5FF] text-[#E6EDF3] text-[10px] font-mono font-bold flex items-center gap-1 disabled:opacity-40"
              >
                <StepForward className="w-3 h-3" />
                <span>+1 TAG</span>
              </button>
              <button
                type="button"
                onClick={handleNewLiveAttempt}
                className="px-2.5 py-1 border border-[#263042] bg-[#07090E] hover:text-[#00E5FF] text-[#8B95A5] text-[10px] font-mono font-bold flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                <span>NEUER LAUF</span>
              </button>
            </div>
          </div>

          {liveRulesOutOfSync && (
            <div className="px-3 py-1 bg-[#1A160B] border-b border-[#F59E0B]/40 flex items-center justify-between text-[10px] font-mono text-[#F59E0B] shrink-0">
              <span>
                Aktiver Lauf nutzt noch die Startregeln ({liveSnap.firmName} · {liveSnap.drawdownMode} · $
                {liveSnap.accountSizeUsd.toLocaleString('en-US')}). Geänderte Regeln greifen ab &bdquo;NEUER LAUF&ldquo;.
              </span>
              <button
                type="button"
                onClick={handleNewLiveAttempt}
                className="underline font-bold ml-2 whitespace-nowrap"
              >
                Jetzt neu starten
              </button>
            </div>
          )}

          {liveAttempt.breachReason && (
            <div
              className={`px-3 py-1.5 border-b border-[#263042] text-xs font-mono font-bold shrink-0 ${
                liveAttempt.outcome === 'PASSED_FUNDED'
                  ? 'bg-[#089981]/15 text-[#089981]'
                  : 'bg-[#F23645]/15 text-[#F23645]'
              }`}
            >
              {liveAttempt.breachReason}
            </div>
          )}

          {/* Dedicated Live Trade-Step SVG Chart */}
          <div className="bg-[#07090E] border-b border-[#263042] px-2 pt-1 pb-1 shrink-0">
            <div className="flex items-center justify-between text-[9px] font-mono tabular-nums text-[#8B95A5] px-1 mb-0.5">
              <span>
                LIVE TRADE-STEP CHART ({liveAttempt.trades.length} Trades · {liveSnap.drawdownMode})
              </span>
              {hoveredTradeIdx !== null && liveAttempt.trades[hoveredTradeIdx] ? (
                <span className="text-[#00E5FF]">
                  Trade #{liveAttempt.trades[hoveredTradeIdx].tradeNum} (T
                  {liveAttempt.trades[hoveredTradeIdx].day} · P
                  {liveAttempt.trades[hoveredTradeIdx].phase}) · Eq $
                  {liveAttempt.trades[hoveredTradeIdx].equityAfterUsd.toLocaleString('en-US')} · DD-Floor $
                  {liveAttempt.trades[hoveredTradeIdx].drawdownFloorUsd.toLocaleString('en-US')}
                </span>
              ) : (
                <span>
                  <span className="text-[#00E5FF]">Equity</span> ·{' '}
                  <span className="text-[#F59E0B]">DD-Floor</span> ·{' '}
                  <span className="text-[#F23645]">Daily-Floor</span> ·{' '}
                  <span className="text-[#089981]">Phase-Ziel</span>
                </span>
              )}
            </div>
            <svg viewBox={`0 0 ${LIVE_W} ${LIVE_H}`} className="w-full h-[136px] block">
              {/* Account Start Baseline */}
              <line
                x1={PAD_L}
                y1={yForLiveEq(liveSnap.accountSizeUsd)}
                x2={LIVE_W - PAD_R}
                y2={yForLiveEq(liveSnap.accountSizeUsd)}
                stroke="#334155"
                strokeDasharray="3 3"
                strokeWidth="1"
              />
              {/* Active Phase Target */}
              <line
                x1={PAD_L}
                y1={yForLiveEq(liveAttempt.phaseTargetUsd)}
                x2={LIVE_W - PAD_R}
                y2={yForLiveEq(liveAttempt.phaseTargetUsd)}
                stroke="#089981"
                strokeDasharray="4 2"
                strokeWidth="1.1"
              />
              <text
                x={LIVE_W - PAD_R + 4}
                y={Math.max(LIVE_PAD_T + 8, Math.min(LIVE_H - LIVE_PAD_B, yForLiveEq(liveAttempt.phaseTargetUsd) + 3))}
                fill="#089981"
                fontSize="8.5"
                fontFamily="JetBrains Mono, monospace"
              >
                ${Math.round(liveAttempt.phaseTargetUsd).toLocaleString('en-US')}
              </text>

              {/* Phase Promotion Reset Markers */}
              {liveTradeStepMeta.promoResetIndices.map((promo) => {
                const px = xForLiveStep(promo.idx);
                return (
                  <g key={`promo-${promo.idx}-${promo.toPhase}`}>
                    <line
                      x1={px}
                      y1={LIVE_PAD_T}
                      x2={px}
                      y2={LIVE_H - LIVE_PAD_B}
                      stroke="#10B981"
                      strokeOpacity="0.65"
                      strokeDasharray="2 2"
                      strokeWidth="1"
                    />
                    <text
                      x={px + 3}
                      y={LIVE_PAD_T + 8}
                      fill="#10B981"
                      fontSize="8"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {promo.toPhase === 3 ? 'FUNDED' : `P${promo.toPhase}`}
                    </text>
                  </g>
                );
              })}

              {/* Daily Floor History */}
              {(liveAttempt.dailyFloorHistory || []).length > 1 && (
                <polyline
                  fill="none"
                  stroke="#F23645"
                  strokeOpacity="0.55"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                  points={(liveAttempt.dailyFloorHistory || [])
                    .map((val, idx) => `${xForLiveStep(idx).toFixed(1)},${yForLiveEq(val).toFixed(1)}`)
                    .join(' ')}
                />
              )}

              {/* Drawdown Floor Trajectory */}
              {liveAttempt.floorHistory.length > 1 && (
                <polyline
                  fill="none"
                  stroke="#F59E0B"
                  strokeWidth="1.5"
                  strokeDasharray="4 2"
                  points={liveAttempt.floorHistory
                    .map((val, idx) => `${xForLiveStep(idx).toFixed(1)},${yForLiveEq(val).toFixed(1)}`)
                    .join(' ')}
                />
              )}
              <text
                x={LIVE_W - PAD_R + 4}
                y={Math.max(LIVE_PAD_T + 8, Math.min(LIVE_H - LIVE_PAD_B, yForLiveEq(liveAttempt.drawdownFloorUsd) + 3))}
                fill="#F59E0B"
                fontSize="8.5"
                fontFamily="JetBrains Mono, monospace"
              >
                DD ${Math.round(liveAttempt.drawdownFloorUsd).toLocaleString('en-US')}
              </text>

              {/* Live Trade-Step Equity Curve */}
              {liveAttempt.equityHistory.length > 1 && (
                <polyline
                  fill="none"
                  stroke="#00E5FF"
                  strokeWidth="2.2"
                  points={liveAttempt.equityHistory
                    .map((val, idx) => `${xForLiveStep(idx).toFixed(1)},${yForLiveEq(val).toFixed(1)}`)
                    .join(' ')}
                />
              )}

              {/* Interactive Trade Hover Targets */}
              {liveAttempt.trades.map((tr, tIdx) => {
                const histIdx = Math.min(
                  liveAttempt.equityHistory.length - 1,
                  liveTradeStepMeta.stepIndices[tIdx] ?? tIdx + 1
                );
                const cx = xForLiveStep(histIdx);
                const cy = yForLiveEq(tr.equityAfterUsd);
                return (
                  <circle
                    key={`tr-pt-${tr.tradeNum}`}
                    cx={cx}
                    cy={cy}
                    r={hoveredTradeIdx === tIdx ? 3.5 : 2.2}
                    fill={
                      tr.statusNote.includes('BREACH')
                        ? '#F23645'
                        : hoveredTradeIdx === tIdx
                        ? '#F59E0B'
                        : '#00E5FF'
                    }
                    fillOpacity={hoveredTradeIdx === tIdx || tr.statusNote.includes('BREACH') ? 1 : 0.45}
                    onMouseEnter={() => setHoveredTradeIdx(tIdx)}
                    onMouseLeave={() => setHoveredTradeIdx(null)}
                    className="cursor-crosshair"
                  />
                );
              })}

              <text
                x={PAD_L}
                y={LIVE_H - 4}
                fill="#64748B"
                fontSize="8.5"
                fontFamily="JetBrains Mono, monospace"
              >
                Trade 0
              </text>
              <text
                x={LIVE_W - PAD_R}
                y={LIVE_H - 4}
                textAnchor="end"
                fill="#64748B"
                fontSize="8.5"
                fontFamily="JetBrains Mono, monospace"
              >
                Trade {liveAttempt.trades.length}
              </text>
            </svg>
          </div>

          {/* Active Attempt Trade-by-Trade Ledger */}
          <div className="flex-1 overflow-y-auto px-3 py-1.5">
            {liveAttempt.trades.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs font-mono text-[#8B95A5]">
                Starte den aktiven Challenge-Test über &bdquo;AUTO-TEST&ldquo; oder &bdquo;+1 TAG&ldquo;, um jeden Trade gegen Drawdown-Floor &amp; Profit-Target live zu testen.
              </div>
            ) : (
              <table className="w-full text-left border-collapse font-mono tabular-nums text-[11px]">
                <thead>
                  <tr className="border-b border-[#1E2634] text-[10px] text-[#8B95A5]">
                    <th className="py-1 pr-2">#</th>
                    <th className="py-1 pr-2">TAG / PHASE</th>
                    <th className="py-1 pr-2 text-right">R-MULT</th>
                    <th className="py-1 pr-2 text-right">PNL $</th>
                    <th className="py-1 pr-2 text-right">EQUITY</th>
                    <th className="py-1 pr-2 text-right">DD-FLOOR</th>
                    <th className="py-1 text-right">STATUS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E2634]/60">
                  {[...liveAttempt.trades].reverse().slice(0, 60).map((t) => (
                    <tr key={t.tradeNum} className="hover:bg-[#131924]">
                      <td className="py-1 pr-2 text-[#8B95A5]">{t.tradeNum}</td>
                      <td className="py-1 pr-2 text-[#E6EDF3]">
                        T{t.day} · {t.phase === 3 ? 'FUNDED' : `P${t.phase}`}
                      </td>
                      <td
                        className={`py-1 pr-2 text-right font-bold ${
                          t.isWin ? 'text-[#089981]' : 'text-[#F23645]'
                        }`}
                      >
                        {t.rMultiple >= 0 ? '+' : ''}
                        {t.rMultiple.toFixed(2)}R
                      </td>
                      <td
                        className={`py-1 pr-2 text-right ${
                          t.pnlUsd >= 0 ? 'text-[#089981]' : 'text-[#F23645]'
                        }`}
                      >
                        {t.pnlUsd >= 0 ? '+' : '-'}${Math.abs(t.pnlUsd).toFixed(0)}
                      </td>
                      <td className="py-1 pr-2 text-right text-[#E6EDF3]">
                        ${t.equityAfterUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      </td>
                      <td className="py-1 pr-2 text-right text-[#F59E0B]">
                        ${t.drawdownFloorUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      </td>
                      <td
                        className={`py-1 text-right text-[10px] ${
                          t.statusNote.includes('BREACH')
                            ? 'text-[#F23645] font-bold'
                            : t.isWin
                            ? 'text-[#089981]'
                            : 'text-[#8B95A5]'
                        }`}
                      >
                        {t.statusNote}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
