import React, { useState } from 'react';
import {
  Bot,
  X,
  Zap,
  DollarSign,
  TrendingUp,
  Target,
  Sliders,
  Receipt,
  ShieldAlert,
  Clock,
  Trophy,
  ArrowUp,
  ArrowDown,
  Play,
  Pause,
  Square,
  SlidersHorizontal,
  Check,
} from 'lucide-react';
import { WorkerBotData } from '../types/trading';

interface WorkerBotCardProps {
  bot: WorkerBotData;
  onClose?: () => void;
  onToggleStatus?: (botId: string) => void;
  onStopBot?: (botId: string) => void;
  onUpdateParameters?: (
    botId: string,
    updates: { leverage?: number; dcaRangeMin?: number; dcaRangeMax?: number }
  ) => void;
  isCompact?: boolean;
}

export const WorkerBotCard: React.FC<WorkerBotCardProps> = ({
  bot,
  onClose,
  onToggleStatus,
  onStopBot,
  onUpdateParameters,
  isCompact = false,
}) => {
  const [isEditingParams, setIsEditingParams] = useState<boolean>(false);
  const [customLeverage, setCustomLeverage] = useState<number>(bot.leverage);
  const [customDcaMin, setCustomDcaMin] = useState<number>(bot.metrics.dcaRangeMin);
  const [customDcaMax, setCustomDcaMax] = useState<number>(bot.metrics.dcaRangeMax);

  // Dynamic formatting utilities (adaptable to any token price scale)
  const formatPrice = (val: number | undefined) => {
    if (val === undefined || isNaN(val)) return '0.00';
    if (val >= 1000) {
      return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (val < 1) {
      return val.toFixed(4);
    }
    return val.toFixed(3);
  };

  const formatCurrency = (val: number | undefined) => {
    if (val === undefined || isNaN(val)) return '0.00 $';
    const sign = val > 0 ? '+' : val < 0 ? '-' : '';
    return `${sign}${Math.abs(val).toFixed(2)} $`;
  };

  const formatTimestamp = (ts: Date | string | undefined) => {
    if (!ts) return new Date().toTimeString().split(' ')[0];
    if (ts instanceof Date) return ts.toTimeString().split(' ')[0];
    return String(ts);
  };

  const isActive = bot.status === 'active' || bot.status === 'ACTIVE';
  const isCompleted = bot.status === 'completed';
  const isStopped = bot.status === 'stopped';
  const isLiquidated = bot.status === 'liquidated';
  const isHistorical = isCompleted || isStopped || isLiquidated;

  const isProfitPositive = (bot.unrealizedPnL?.value ?? 0) >= 0;
  const isLong = bot.direction === 'LONG';

  // Pair and Strategy label normalization
  const displayPair = bot.pair || bot.symbol || 'ASSET/USDT.P';
  const displayStrategy = bot.strategy || bot.instrumentType || 'PERPETUAL FUTURES · STRATEGY';

  // Metrics normalization
  const investment = bot.metrics?.investment ?? bot.investmentUsd ?? 100;
  const currencySymbol = bot.metrics?.currency || '$';
  const investmentEur = bot.metrics?.investmentEur ?? (bot.investmentEur ?? investment * 0.915);
  const realizedProfit = bot.metrics?.realizedProfit ?? bot.currentProfitUsd ?? 0;
  const profitCycleType = bot.metrics?.profitCycleType || 'Realisiert (Zyklus)';
  const dcaMin = bot.metrics?.dcaRangeMin ?? 0;
  const dcaMax = bot.metrics?.dcaRangeMax ?? 0;
  const dcaSteps = bot.metrics?.dcaSteps ?? 100;
  const dcaOrdersTriggered = bot.metrics?.dcaOrdersTriggered ?? bot.dcaOrdersTriggered ?? 0;
  const fundingFees = bot.metrics?.fundingFees ?? 0;
  const liquidationPrice = bot.metrics?.liquidationPrice ?? 0;
  const liquidationDistancePct = bot.metrics?.liquidationDistancePct ?? 0;

  // Runtime normalization
  const days = bot.runtime?.days ?? 0;
  const hours = bot.runtime?.hours ?? 0;
  const minutes = bot.runtime?.minutes ?? 0;
  const cycles = bot.runtime?.cycles ?? 0;
  const cycleProgressPct = bot.runtime?.cycleProgressPct ?? 50;

  // Total Performance normalization
  const totalProfit = bot.totalProfit ?? bot.totalProfitUsd ?? 0;
  const roi = bot.roi ?? bot.roiPct ?? 0;
  const apr = bot.apr ?? bot.aprPct ?? 0;

  const handleSaveParams = (e: React.FormEvent) => {
    e.preventDefault();
    if (onUpdateParameters) {
      onUpdateParameters(bot.id, {
        leverage: customLeverage,
        dcaRangeMin: customDcaMin,
        dcaRangeMax: customDcaMax,
      });
    }
    setIsEditingParams(false);
  };

  return (
    <div
      id={`worker-bot-widget-${bot.id}`}
      className="w-full max-w-[420px] bg-[#0c101d] border border-slate-800/90 rounded-2xl p-4 shadow-2xl space-y-3 font-sans transition-all duration-300 hover:border-slate-700"
      style={{
        boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.7), 0 0 25px -5px rgba(99, 102, 241, 0.05)',
      }}
    >
      {/* 1. Header with Dynamic Bot Avatar, Name, ID, Exchange & Controls */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/25 via-purple-600/30 to-indigo-800/40 border border-purple-500/30 flex items-center justify-center shrink-0 shadow-lg shadow-purple-500/10 text-purple-300">
            <Bot className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-slate-100 font-bold text-base leading-tight tracking-tight truncate">
              {bot.name}
            </h3>
            <p className="text-slate-400 font-mono text-xs mt-0.5 flex items-center gap-1.5 truncate">
              <span>ID: {bot.id}</span>
              <span className="text-slate-600">•</span>
              <span className="text-slate-400">{bot.exchange}</span>
            </p>
          </div>
        </div>

        {/* Action controls: Parameter Tuning, Status Toggle & Close */}
        <div className="flex items-center gap-1.5 shrink-0">
          {onUpdateParameters && (
            <button
              type="button"
              onClick={() => setIsEditingParams(!isEditingParams)}
              className={`p-1.5 rounded-lg border transition-colors ${
                isEditingParams
                  ? 'bg-purple-600/30 border-purple-500/50 text-purple-200'
                  : 'bg-slate-800/60 hover:bg-slate-800 border-slate-700/50 text-slate-400 hover:text-slate-200'
              }`}
              title="Parameter anpassen (Hebel, DCA-Range)"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
            </button>
          )}

          {onToggleStatus && !isHistorical && (
            <button
              type="button"
              onClick={() => onToggleStatus(bot.id)}
              className="p-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-800 border border-slate-700/50 text-slate-400 hover:text-slate-200 transition-colors"
              title={isActive ? 'Worker pausieren' : 'Worker aktivieren'}
            >
              {isActive ? (
                <Pause className="w-3.5 h-3.5 text-amber-400" />
              ) : (
                <Play className="w-3.5 h-3.5 text-emerald-400" />
              )}
            </button>
          )}

          {onStopBot && !isHistorical && (
            <button
              type="button"
              onClick={() => onStopBot(bot.id)}
              className="p-1.5 rounded-lg bg-slate-800/60 hover:bg-rose-950/40 border border-slate-700/50 hover:border-rose-500/50 text-slate-400 hover:text-rose-300 transition-colors"
              title="Worker stoppen & in Historie archivieren"
            >
              <Square className="w-3.5 h-3.5 text-rose-400" />
            </button>
          )}

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-800 border border-slate-700/50 text-slate-400 hover:text-slate-200 transition-colors"
              title="Widget schließen"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Optional Interactive Parameter Tuning Drawer */}
      {isEditingParams && (
        <form
          onSubmit={handleSaveParams}
          className="bg-slate-900 border border-purple-500/30 rounded-xl p-3 space-y-2.5 text-xs font-mono"
        >
          <div className="flex items-center justify-between text-purple-300 font-bold border-b border-slate-800 pb-1.5">
            <span>PARAMETER ANPASSEN ({bot.id})</span>
            <span className="text-[10px] text-slate-400 font-normal">M8-Gate validiert</span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Hebel (x)</label>
              <input
                type="number"
                min="1"
                max="125"
                value={customLeverage}
                onChange={(e) => setCustomLeverage(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs focus:border-purple-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">DCA Min</label>
              <input
                type="number"
                step="any"
                value={customDcaMin}
                onChange={(e) => setCustomDcaMin(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs focus:border-purple-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">DCA Max</label>
              <input
                type="number"
                step="any"
                value={customDcaMax}
                onChange={(e) => setCustomDcaMax(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs focus:border-purple-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setIsEditingParams(false)}
              className="px-2 py-1 rounded bg-slate-800 text-slate-400 hover:text-slate-200"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              className="px-2.5 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white font-bold flex items-center gap-1 shadow-sm"
            >
              <Check className="w-3 h-3" />
              <span>Übernehmen</span>
            </button>
          </div>
        </form>
      )}

      {/* 2. Asset & Contract Bar (Fully Generic Token Pair, Strategy, Direction & Leverage) */}
      <div className="bg-[#131929] border border-slate-800/80 rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative flex items-center justify-center">
            <span
              className={`w-2.5 h-2.5 rounded-full inline-block ${
                isActive
                  ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)] animate-pulse'
                  : isCompleted
                  ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]'
                  : isLiquidated
                  ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]'
                  : isStopped
                  ? 'bg-slate-400'
                  : 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]'
              }`}
            />
          </div>
          <div className="min-w-0">
            <div className="text-slate-100 font-extrabold text-base font-mono tracking-wide truncate">
              {displayPair}
            </div>
            <div className="text-[10px] text-slate-400 font-mono tracking-wider uppercase truncate">
              {displayStrategy}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isHistorical && (
            <span
              className={`px-2 py-1 rounded-md border text-[10px] font-bold font-mono uppercase tracking-wider ${
                isCompleted
                  ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-400'
                  : isLiquidated
                  ? 'bg-rose-950/60 border-rose-500/40 text-rose-400'
                  : 'bg-slate-800/80 border-slate-700 text-slate-300'
              }`}
            >
              {bot.finishReason || (isCompleted ? 'TAKE-PROFIT' : 'BEENDET')}
            </span>
          )}
          <span
            className={`px-2 py-1 rounded-md border text-xs font-bold font-mono flex items-center gap-1 ${
              isLong
                ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-400'
                : 'bg-rose-950/60 border-rose-500/40 text-rose-400'
            }`}
          >
            {isLong ? (
              <ArrowUp className="w-3 h-3 stroke-[2.5]" />
            ) : (
              <ArrowDown className="w-3 h-3 stroke-[2.5]" />
            )}
            {bot.direction}
          </span>
          <span className="px-2 py-1 rounded-md bg-purple-950/60 border border-purple-500/40 text-purple-300 text-xs font-bold font-mono">
            {bot.leverage}×
          </span>
        </div>
      </div>

      {/* 3. Unrealized P&L Hero Card (Real-time P&L, Entry Price & Current Price) */}
      <div className="bg-[#121929] border border-slate-800/80 rounded-xl p-3.5 flex items-center justify-between gap-3">
        {/* Left: Unrealized P&L */}
        <div>
          <div className="text-amber-400 text-[11px] font-mono font-semibold flex items-center gap-1.5 uppercase tracking-wider">
            <Zap className="w-3 h-3 text-amber-400 fill-amber-400/20" />
            UNREALIZED P&amp;L
          </div>
          <div
            className={`text-2xl sm:text-3xl font-extrabold font-mono tracking-tight mt-1 ${
              isProfitPositive ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {formatCurrency(bot.unrealizedPnL?.value)}
          </div>
          <div
            className={`text-xs font-mono font-semibold flex items-center gap-1 mt-0.5 ${
              (bot.unrealizedPnL?.percentage ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            <span>{(bot.unrealizedPnL?.percentage ?? 0) >= 0 ? '▲' : '▼'}</span>
            <span>
              {(bot.unrealizedPnL?.percentage ?? 0) >= 0
                ? `+${(bot.unrealizedPnL?.percentage ?? 0).toFixed(2)}%`
                : `${(bot.unrealizedPnL?.percentage ?? 0).toFixed(2)}%`}
            </span>
          </div>
        </div>

        {/* Right: Dynamic Entry Price & Current Price */}
        <div className="text-right space-y-1.5 shrink-0">
          <div>
            <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
              EINSTIEGSPREIS
            </div>
            <div className="text-slate-200 font-mono font-bold text-sm mt-0.5">
              {formatPrice(bot.entryPrice)} {currencySymbol}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
              AKTUELLER PREIS
            </div>
            <div className="text-emerald-400 font-mono font-bold text-sm mt-0.5">
              {formatPrice(bot.currentPrice)} {currencySymbol}
            </div>
          </div>
        </div>
      </div>

      {/* 4. 2x3 Metric Grid (Fully Populated from Bot Metrics Props) */}
      <div className="grid grid-cols-2 gap-2.5">
        {/* Metric 1: Investment */}
        <div className="bg-[#131929] border border-slate-800/80 rounded-xl p-3 flex flex-col justify-between">
          <div className="text-amber-400 text-[10px] font-mono font-semibold uppercase tracking-wider flex items-center gap-1.5">
            <DollarSign className="w-3 h-3 text-amber-400" />
            INVESTMENT
          </div>
          <div className="text-slate-100 font-mono font-bold text-base mt-1">
            {investment.toFixed(2)} {currencySymbol}
          </div>
          <div className="text-slate-500 font-mono text-[11px] mt-0.5">
            {investmentEur.toFixed(2)} EUR
          </div>
        </div>

        {/* Metric 2: Akt. Gewinn */}
        <div className="bg-[#131929] border border-slate-800/80 rounded-xl p-3 flex flex-col justify-between">
          <div className="text-rose-400 text-[10px] font-mono font-semibold uppercase tracking-wider flex items-center gap-1.5">
            <TrendingUp className="w-3 h-3 text-rose-400" />
            AKT. GEWINN
          </div>
          <div className="text-emerald-400 font-mono font-bold text-base mt-1">
            {formatCurrency(realizedProfit)}
          </div>
          <div className="text-slate-500 font-mono text-[11px] mt-0.5 truncate">
            {profitCycleType}
          </div>
        </div>

        {/* Metric 3: DCA Range */}
        <div className="bg-[#131929] border border-slate-800/80 rounded-xl p-3 flex flex-col justify-between">
          <div className="text-rose-400 text-[10px] font-mono font-semibold uppercase tracking-wider flex items-center gap-1.5">
            <Target className="w-3 h-3 text-rose-400" />
            DCA RANGE
          </div>
          <div className="text-slate-100 font-mono font-bold text-base mt-1">
            {formatPrice(dcaMin)} – {formatPrice(dcaMax)}
          </div>
          <div className="text-slate-500 font-mono text-[11px] mt-0.5">
            {dcaSteps} DCA-STUFEN
          </div>
        </div>

        {/* Metric 4: DCA Orders */}
        <div className="bg-[#131929] border border-slate-800/80 rounded-xl p-3 flex flex-col justify-between">
          <div className="text-sky-400 text-[10px] font-mono font-semibold uppercase tracking-wider flex items-center gap-1.5">
            <Sliders className="w-3 h-3 text-sky-400" />
            DCA ORDERS
          </div>
          <div className="text-slate-100 font-mono font-bold text-base mt-1">
            {dcaOrdersTriggered}
          </div>
          <div className="text-slate-500 font-mono text-[11px] mt-0.5">
            Ausgelöste Käufe
          </div>
        </div>

        {/* Metric 5: Funding Fees */}
        <div className="bg-[#131929] border border-slate-800/80 rounded-xl p-3 flex flex-col justify-between">
          <div className="text-emerald-400 text-[10px] font-mono font-semibold uppercase tracking-wider flex items-center gap-1.5">
            <Receipt className="w-3 h-3 text-emerald-400" />
            FUNDING FEES
          </div>
          <div className="text-amber-400 font-mono font-bold text-base mt-1">
            {formatCurrency(fundingFees)}
          </div>
          <div className="text-slate-500 font-mono text-[11px] mt-0.5">
            Kumuliert
          </div>
        </div>

        {/* Metric 6: Liquidation */}
        <div className="bg-[#131929] border border-slate-800/80 rounded-xl p-3 flex flex-col justify-between">
          <div className="text-sky-400 text-[10px] font-mono font-semibold uppercase tracking-wider flex items-center gap-1.5">
            <ShieldAlert className="w-3 h-3 text-sky-400" />
            LIQUIDATION
          </div>
          <div className="text-rose-500 font-mono font-bold text-base mt-1">
            {formatPrice(liquidationPrice)} {currencySymbol}
          </div>
          <div className="text-slate-500 font-mono text-[11px] mt-0.5">
            {liquidationDistancePct >= 0 ? `+${liquidationDistancePct.toFixed(2)}%` : `${liquidationDistancePct.toFixed(2)}%`} vom Einstieg
          </div>
        </div>
      </div>

      {/* 5. Runtime & Cycles Bar */}
      <div className="bg-[#131929] border border-slate-800/80 rounded-xl p-3 flex items-center justify-between gap-3">
        <div className="shrink-0">
          <div className="text-[10px] text-slate-400 font-mono uppercase tracking-wider flex items-center gap-1">
            <Clock className="w-3 h-3 text-slate-400" />
            LAUFZEIT
          </div>
          <div className="text-slate-100 font-mono font-bold text-xs mt-0.5">
            {String(days).padStart(2, '0')}d {String(hours).padStart(2, '0')}h {String(minutes).padStart(2, '0')}m
          </div>
        </div>

        {/* Dynamic Progress Bar */}
        <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden mx-1.5">
          <div
            className="h-full bg-gradient-to-r from-purple-600 via-indigo-500 to-purple-400 rounded-full shadow-[0_0_8px_rgba(168,85,247,0.5)] transition-all duration-500"
            style={{ width: `${Math.min(100, Math.max(5, cycleProgressPct))}%` }}
          />
        </div>

        <div className="text-right shrink-0">
          <div className="text-[10px] text-slate-400 font-mono">
            Zyklen
          </div>
          <div className="text-purple-400 font-mono font-bold text-xs mt-0.5">
            {cycles}×
          </div>
        </div>
      </div>

      {/* 6. Total Profit Hero Card */}
      <div className="bg-gradient-to-r from-[#141630] to-[#10182c] border border-purple-500/30 rounded-xl p-3.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-amber-400 font-mono font-bold text-xs uppercase tracking-wider">
            TOTAL PROFIT
          </span>
        </div>

        <div className="text-right">
          <div className="text-purple-400 font-mono font-extrabold text-xl tracking-tight">
            {formatCurrency(totalProfit)}
          </div>
          <div className="text-indigo-300 font-mono text-[10px] font-semibold mt-0.5">
            ROI: +{roi.toFixed(2)}% • APR +{apr.toLocaleString('en-US')}%
          </div>
        </div>
      </div>

      {/* 7. Status Footer with Live Timestamp */}
      <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 px-1 pt-0.5">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full inline-block ${
              isActive
                ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]'
                : isCompleted
                ? 'bg-emerald-400'
                : isLiquidated
                ? 'bg-rose-400'
                : isStopped
                ? 'bg-slate-400'
                : 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]'
            }`}
          />
          <span className="text-slate-300">
            {bot.statusText ||
              (isActive
                ? 'Bot aktiv · Verbunden'
                : isHistorical
                ? `Beendet · ${bot.finishReason || 'Archiviert'}`
                : 'Bot pausiert')}
          </span>
        </div>
        <div className="text-slate-500 text-[10px]">
          {isHistorical && bot.finishedAt
            ? `Beendet: ${bot.finishedAt}`
            : `Aktualisiert: ${formatTimestamp(bot.lastUpdate || bot.lastUpdated)}`}
        </div>
      </div>
    </div>
  );
};
