import React from 'react';
import { Shield, ShieldAlert, CheckCircle2, XCircle, AlertTriangle, Cpu, ArrowRight } from 'lucide-react';
import { GateResult, JudgeVerdict, JudgeConfig } from '../types/trading';

interface M8GateRadarProps {
  recentVerdicts: JudgeVerdict[];
  config: JudgeConfig;
}

export const M8GateRadar: React.FC<M8GateRadarProps> = ({ recentVerdicts, config }) => {
  const totalEvaluated = recentVerdicts.length;
  const approvedCount = recentVerdicts.filter((v) => v.status === 'PASSED').length;
  const modifiedCount = recentVerdicts.filter((v) => v.status === 'MODIFIED').length;
  const rejectedCount = recentVerdicts.filter((v) => v.status === 'REJECTED').length;
  const rejectionRate = totalEvaluated > 0 ? Math.round((rejectedCount / totalEvaluated) * 100) : 0;

  const gatesMeta = [
    {
      id: 'M1',
      name: 'Sanity & Latency',
      desc: 'Checks tick freshness & monotonic sequence',
      threshold: `<= ${config.signalMaxLatencyMs}ms`,
      type: 'HARD_REJECT',
    },
    {
      id: 'M2',
      name: 'Gross Exposure',
      desc: 'Net & Gross aggregate leverage limit',
      threshold: `<= ${config.maxGrossLeverage}x NAV`,
      type: 'HARD_REJECT',
    },
    {
      id: 'M3',
      name: 'Vol Regime Filter',
      desc: 'Parkinson / GARCH volatility dampener',
      threshold: `<= ${config.volatilityCeilingAtrRatio}x ATR`,
      type: 'PROPORTIONAL',
    },
    {
      id: 'M4',
      name: 'Kelly Capital Sizer',
      desc: 'Fractional Kelly sizing optimization',
      threshold: `${(config.kellyFraction * 100).toFixed(0)}% Half-Kelly`,
      type: 'SIZING_MOD',
    },
    {
      id: 'M5',
      name: 'Drawdown Breaker',
      desc: 'Daily limit & peak trailing stop',
      threshold: `Max -${config.maxTotalDrawdownPct}%`,
      type: 'CIRCUIT_BREAK',
    },
    {
      id: 'M6',
      name: 'ADV & Spread Barrier',
      desc: 'Bid-ask spread & order slice participation',
      threshold: `<= ${config.maxSpreadBpsThreshold} bps`,
      type: 'HARD_REJECT',
    },
    {
      id: 'M7',
      name: '99% CVaR Barrier',
      desc: 'Cornish-Fisher expected shortfall stress',
      threshold: `<= $${(config.cvarLimitUsd / 1000).toFixed(0)}k CVaR`,
      type: 'RISK_CAP',
    },
    {
      id: 'M8',
      name: 'Execution Routing',
      desc: 'DMA, TWAP/VWAP slicer, Iceberg selector',
      threshold: 'Optimal Route',
      type: 'ROUTER',
    },
  ];

  // Count failures by gate
  const gateFailures: Record<string, number> = {};
  for (const v of recentVerdicts) {
    if (v.failedGate) {
      gateFailures[v.failedGate] = (gateFailures[v.failedGate] || 0) + 1;
    }
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm space-y-4">
      {/* Header & Overall Statistics */}
      <div className="flex items-center justify-between flex-wrap gap-2 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
            <Shield className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-mono font-bold text-white uppercase tracking-wider">
              THE JUDGE: M8-GATE INVARIANT RADAR
            </h3>
            <p className="text-[11px] text-slate-400 font-sans">
              8-tier quantitative risk adjudication pipeline separating Swarm alpha from execution
            </p>
          </div>
        </div>

        {/* Stats Pills */}
        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="px-2.5 py-1 rounded bg-slate-950 border border-slate-800 text-slate-300">
            ADJUDICATED: <strong className="text-white">{totalEvaluated}</strong>
          </span>
          <span className="px-2.5 py-1 rounded bg-emerald-950/40 border border-emerald-800 text-emerald-300">
            PASSED: <strong>{approvedCount}</strong>
          </span>
          <span className="px-2.5 py-1 rounded bg-amber-950/40 border border-amber-800 text-amber-300">
            MODIFIED: <strong>{modifiedCount}</strong>
          </span>
          <span className="px-2.5 py-1 rounded bg-rose-950/40 border border-rose-800 text-rose-300">
            REJECTED: <strong>{rejectedCount} ({rejectionRate}%)</strong>
          </span>
        </div>
      </div>

      {/* 8 Gates Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {gatesMeta.map((gate) => {
          const failCount = gateFailures[gate.id] || 0;
          const hasRecentFailure = failCount > 0;

          return (
            <div
              key={gate.id}
              className={`p-2.5 rounded-lg border flex flex-col justify-between transition-all ${
                hasRecentFailure
                  ? 'bg-rose-950/20 border-rose-500/40 text-rose-200'
                  : 'bg-slate-950/60 border-slate-800 text-slate-300'
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-cyan-400">{gate.id}</span>
                  {hasRecentFailure ? (
                    <span className="text-[10px] font-mono px-1 py-0.2 bg-rose-900/60 text-rose-300 rounded">
                      {failCount} BLOCKED
                    </span>
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  )}
                </div>
                <div className="text-xs font-semibold text-white mt-1 truncate">{gate.name}</div>
                <div className="text-[10px] text-slate-400 mt-0.5 line-clamp-2 leading-tight">{gate.desc}</div>
              </div>

              <div className="mt-2 pt-1.5 border-t border-slate-800/60 text-[10px] font-mono flex items-center justify-between text-slate-400">
                <span>CUTOFF</span>
                <span className="text-cyan-300 font-semibold">{gate.threshold}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Latest Adjudication Detail */}
      {recentVerdicts.length > 0 && (
        <div className="bg-slate-950/80 border border-slate-800/80 rounded-lg p-3 text-xs font-mono">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
            <span className="flex items-center gap-1.5 text-cyan-400 font-semibold">
              <Cpu className="w-3.5 h-3.5" /> LATEST ADJUDICATION AUDIT TRAIL
            </span>
            <span>ID: {recentVerdicts[0].signalId}</span>
          </div>
          <div className="flex items-center gap-3 text-xs flex-wrap">
            <span className="text-white font-bold">{recentVerdicts[0].symbol}</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                recentVerdicts[0].direction === 'LONG' ? 'bg-emerald-950 text-emerald-400' : 'bg-rose-950 text-rose-400'
              }`}
            >
              {recentVerdicts[0].direction}
            </span>
            <span className="text-slate-400">
              Raw: ${recentVerdicts[0].originalSizeUsd.toLocaleString()}
            </span>
            <ArrowRight className="w-3 h-3 text-slate-500" />
            <span className="text-cyan-400 font-bold">
              Approved: ${recentVerdicts[0].approvedSizeUsd.toLocaleString()} ({(recentVerdicts[0].scaleFactor * 100).toFixed(0)}%)
            </span>
            <span className="text-slate-400">Route: <strong className="text-indigo-300">{recentVerdicts[0].executionRoute}</strong></span>
            <span
              className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                recentVerdicts[0].status === 'PASSED'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : recentVerdicts[0].status === 'MODIFIED'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
              }`}
            >
              {recentVerdicts[0].status}
            </span>
          </div>

          {/* Detailed Gate Reasons for Latest */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 mt-2 pt-2 border-t border-slate-800/60 text-[11px] text-slate-400">
            {recentVerdicts[0].gateResults.slice(0, 4).map((gr) => (
              <div key={gr.gateId} className="flex items-center gap-1.5 truncate">
                {gr.passed ? <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" /> : <XCircle className="w-3 h-3 text-rose-400 shrink-0" />}
                <span className="font-semibold text-slate-300">{gr.gateId}:</span>
                <span className="truncate">{gr.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
