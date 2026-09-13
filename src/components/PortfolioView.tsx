import React, { useState, useEffect } from 'react';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  Percent,
  Activity,
  AlertOctagon,
  X,
  ArrowUpRight,
  ArrowDownRight,
  BarChart,
  ShieldAlert,
  Terminal,
  CheckCircle,
} from 'lucide-react';
import { PortfolioState, Position, ExecutionOrder } from '../types/trading';
import { fetchKrakenAccountSummary } from '../services/krakenCliRouter';
import { fetchAuthoritativeBalance, AuthoritativeBalancePayload } from '../services/krakenCliProxyRegistry';
import { KrakenAccountSummary } from '../types/krakenCli';

interface PortfolioViewProps {
  portfolio: PortfolioState;
  orders: ExecutionOrder[];
  onClosePosition: (symbol: string) => void;
  equityHistory: { timestamp: number; nav: number }[];
}

export const PortfolioView: React.FC<PortfolioViewProps> = ({
  portfolio,
  orders,
  onClosePosition,
  equityHistory,
}) => {
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [krakenSummary, setKrakenSummary] = useState<KrakenAccountSummary | null>(null);
  const [authoritative, setAuthoritative] = useState<AuthoritativeBalancePayload | null>(null);

  useEffect(() => {
    const loadAuthoritative = () => {
      fetchKrakenAccountSummary()
        .then((data) => setKrakenSummary(data))
        .catch((err) => console.warn('PortfolioView: Kraken CLI Summary Sync:', err));

      fetchAuthoritativeBalance()
        .then((data) => setAuthoritative(data))
        .catch((err) => console.warn('PortfolioView: Authoritative Balance Sync:', err));
    };

    loadAuthoritative();
    const interval = setInterval(loadAuthoritative, 6000);
    return () => clearInterval(interval);
  }, []);

  // SVG Equity Curve Calculation dynamically bound to actual CLI NAV
  const navValues = equityHistory.length > 0 ? equityHistory.map((e) => e.nav) : [portfolio.navUsd];
  const computedMin = Math.min(...navValues);
  const computedMax = Math.max(...navValues);
  const minNav = computedMin === computedMax ? computedMin * 0.995 : computedMin;
  const maxNav = computedMin === computedMax ? computedMax * 1.005 : computedMax;
  const navRange = Math.max(maxNav - minNav, 1);

  const svgWidth = 600;
  const svgHeight = 120;

  const points = equityHistory
    .map((pt, idx) => {
      const x = (idx / Math.max(equityHistory.length - 1, 1)) * svgWidth;
      const y = svgHeight - ((pt.nav - minNav) / navRange) * (svgHeight - 20) - 10;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const isPaper = authoritative?.mode === 'paper' || krakenSummary?.mode === 'paper';

  return (
    <div className="space-y-4">
      {/* Kraken CLI Verified External Balance Card */}
      {(krakenSummary || authoritative) && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3.5 font-mono text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2.5 mb-2.5">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-amber-400" />
              <span className="font-bold text-slate-200">
                {isPaper
                  ? 'Kraken CLI Paper Ledger Verified (`kraken paper status`)'
                  : 'Kraken CLI Account Balances & Margin Verified (`kraken balance & trade-balance`)'}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                <CheckCircle className="w-3 h-3" />
                CLI ROUTED
              </span>
            </div>
            <div className="text-[11px] text-slate-400">
              Source: <span className="text-amber-400">{authoritative?.sourceOfTruth || (isPaper ? 'kraken paper status' : 'kraken balance')}</span> · Mode: <span className="text-emerald-400 uppercase">{authoritative?.mode || (isPaper ? 'paper' : 'live')}</span>
            </div>
          </div>

          {isPaper ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-[11px]">
              <div className="bg-slate-950/60 p-2 rounded border border-slate-800/60">
                <span className="text-slate-500 block text-[10px]">PAPER CASH</span>
                <span className="text-slate-200 font-bold block mt-0.5">
                  ${(authoritative?.cashUsd ?? portfolio.cashUsd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="bg-slate-950/60 p-2 rounded border border-slate-800/60">
                <span className="text-slate-500 block text-[10px]">PAPER NAV (VALUE)</span>
                <span className="text-emerald-400 font-bold block mt-0.5">
                  ${(authoritative?.navUsd ?? portfolio.navUsd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="bg-slate-950/60 p-2 rounded border border-slate-800/60">
                <span className="text-slate-500 block text-[10px]">REALIZED PnL</span>
                <span className={`font-bold block mt-0.5 ${(authoritative?.realizedPnl ?? portfolio.realizedPnl) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  ${(authoritative?.realizedPnl ?? portfolio.realizedPnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="bg-slate-950/60 p-2 rounded border border-slate-800/60">
                <span className="text-slate-500 block text-[10px]">UNREALIZED PnL</span>
                <span className={`font-bold block mt-0.5 ${(authoritative?.unrealizedPnl ?? portfolio.unrealizedPnl) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  ${(authoritative?.unrealizedPnl ?? portfolio.unrealizedPnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="bg-slate-950/60 p-2 rounded border border-slate-800/60">
                <span className="text-slate-500 block text-[10px]">OPEN POSITIONS</span>
                <span className="text-cyan-400 font-bold block mt-0.5">
                  {authoritative?.positions?.length ?? portfolio.positions.length} Active
                </span>
              </div>
              <div className="bg-slate-950/60 p-2 rounded border border-slate-800/60">
                <span className="text-slate-500 block text-[10px]">CLI TRADES COUNT</span>
                <span className="text-slate-200 font-bold block mt-0.5">
                  {authoritative?.tradesCount ?? portfolio.totalTrades} Executed
                </span>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 text-[11px]">
              <div className="bg-slate-950/60 p-2 rounded border border-slate-800/60">
                <span className="text-slate-500 block text-[10px]">USD CASH</span>
                <span className="text-slate-200 font-bold block mt-0.5">
                  ${(authoritative?.liveBalances?.ZUSD?.balance ?? krakenSummary?.balances.ZUSD?.balance ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="bg-slate-950/60 p-2 rounded border border-slate-800/60">
                <span className="text-slate-500 block text-[10px]">USDT LIQUIDITY</span>
                <span className="text-slate-200 font-bold block mt-0.5">
                  ${(authoritative?.liveBalances?.USDT?.balance ?? krakenSummary?.balances.USDT?.balance ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="bg-slate-950/60 p-2 rounded border border-slate-800/60">
                <span className="text-slate-500 block text-[10px]">BTC COLD/SPOT</span>
                <span className="text-slate-200 font-bold block mt-0.5">
                  {(authoritative?.liveBalances?.XXBT?.balance ?? krakenSummary?.balances.XXBT?.balance ?? 0)} BTC
                </span>
              </div>
              <div className="bg-slate-950/60 p-2 rounded border border-slate-800/60">
                <span className="text-slate-500 block text-[10px]">ETH HOLDINGS</span>
                <span className="text-slate-200 font-bold block mt-0.5">
                  {(authoritative?.liveBalances?.XETH?.balance ?? krakenSummary?.balances.XETH?.balance ?? 0)} ETH
                </span>
              </div>
              <div className="bg-slate-950/60 p-2 rounded border border-slate-800/60">
                <span className="text-slate-500 block text-[10px]">TOTAL MARGIN EQUITY</span>
                <span className="text-emerald-400 font-bold block mt-0.5">
                  ${(authoritative?.tradeBalance?.equity ?? krakenSummary?.trade_balance?.equity ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="bg-slate-950/60 p-2 rounded border border-slate-800/60">
                <span className="text-slate-500 block text-[10px]">FREE MARGIN</span>
                <span className="text-emerald-400 font-bold block mt-0.5">
                  ${(authoritative?.tradeBalance?.free_margin ?? krakenSummary?.trade_balance?.free_margin ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* High-Level Risk & Balance Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg">
          <span className="text-[11px] font-mono text-slate-400 block">Total NAV</span>
          <span className="text-lg font-bold font-mono text-slate-100 mt-1 block">
            ${portfolio.navUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className={`text-[10px] font-mono flex items-center gap-0.5 mt-1 ${portfolio.dailyPnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {portfolio.dailyPnlPct >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {portfolio.dailyPnlPct >= 0 ? '+' : ''}{portfolio.dailyPnlPct.toFixed(2)}% Daily
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg">
          <span className="text-[11px] font-mono text-slate-400 block">Cash Balance</span>
          <span className="text-lg font-bold font-mono text-slate-200 mt-1 block">
            ${Math.round(portfolio.cashUsd).toLocaleString()}
          </span>
          <span className="text-[10px] font-mono text-slate-500 mt-1 block">
            Available Collateral
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg">
          <span className="text-[11px] font-mono text-slate-400 block">Unrealized PnL</span>
          <span className={`text-lg font-bold font-mono mt-1 block ${portfolio.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {portfolio.unrealizedPnl >= 0 ? '+' : ''}${portfolio.unrealizedPnl.toLocaleString()}
          </span>
          <span className="text-[10px] font-mono text-slate-400 mt-1 block">
            Across {portfolio.positions.length} active positions
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg">
          <span className="text-[11px] font-mono text-slate-400 block">Gross / Net Lev</span>
          <span className="text-lg font-bold font-mono text-slate-200 mt-1 block">
            {portfolio.grossLeverage.toFixed(2)}x / {portfolio.netLeverage.toFixed(2)}x
          </span>
          <span className="text-[10px] font-mono text-slate-500 mt-1 block">
            Max Barrier: 3.00x
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg">
          <span className="text-[11px] font-mono text-slate-400 block">99% CVaR Tail Risk</span>
          <span className="text-lg font-bold font-mono text-rose-400 mt-1 block">
            ${portfolio.cvar99Usd.toLocaleString()}
          </span>
          <span className="text-[10px] font-mono text-slate-500 mt-1 block">
            Limit: $25,000 budget
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg">
          <span className="text-[11px] font-mono text-slate-400 block">Peak Drawdown</span>
          <span className="text-lg font-bold font-mono text-amber-400 mt-1 block">
            -{portfolio.currentDrawdownPct.toFixed(2)}%
          </span>
          <span className="text-[10px] font-mono text-slate-500 mt-1 block">
            Historical Max: -{portfolio.maxDrawdownPct.toFixed(2)}%
          </span>
        </div>
      </div>

      {/* Real-Time NAV Equity Curve (SVG) */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <BarChart className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-bold font-mono text-slate-200 uppercase tracking-wider">
              Real-Time NAV Mark-To-Market Curve
            </h3>
          </div>
          <div className="text-[11px] font-mono text-slate-400 flex items-center gap-3">
            <span>High: ${Math.round(maxNav).toLocaleString()}</span>
            <span>Low: ${Math.round(minNav).toLocaleString()}</span>
          </div>
        </div>

        <div className="w-full h-28 bg-slate-950 rounded border border-slate-800/80 p-2 relative overflow-hidden">
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full h-full preserve-3d"
            preserveAspectRatio="none"
          >
            {/* Horizontal Grid lines */}
            <line x1="0" y1={svgHeight / 2} x2={svgWidth} y2={svgHeight / 2} stroke="#334155" strokeDasharray="3 3" strokeWidth="0.5" />
            <line x1="0" y1="10" x2={svgWidth} y2="10" stroke="#1e293b" strokeWidth="0.5" />
            <line x1="0" y1={svgHeight - 10} x2={svgWidth} y2={svgHeight - 10} stroke="#1e293b" strokeWidth="0.5" />

            {/* Path */}
            {points && (
              <>
                <polyline
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={points}
                />
              </>
            )}
          </svg>
        </div>
      </div>

      {/* Active Positions Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3 border-b border-slate-800 pb-2">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-bold font-mono text-slate-200 uppercase tracking-wider">
              Active Positions &amp; Mark-To-Market Exposures ({portfolio.positions.length})
            </h3>
          </div>
          <span className="text-[11px] font-mono text-slate-500">
            DYNAMIC SL / TP INVARIANTS
          </span>
        </div>

        {portfolio.positions.length === 0 ? (
          <div className="p-8 text-center text-slate-500 font-mono text-xs">
            No active positions currently held. Capital fully in cash reserves.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-[11px]">
                  <th className="pb-2 font-medium">SYMBOL</th>
                  <th className="pb-2 font-medium">DIR</th>
                  <th className="pb-2 font-medium">QUANTITY</th>
                  <th className="pb-2 font-medium">ENTRY PRICE</th>
                  <th className="pb-2 font-medium">MARK PRICE</th>
                  <th className="pb-2 font-medium">ALLOCATED USD</th>
                  <th className="pb-2 font-medium">UNREALIZED PnL</th>
                  <th className="pb-2 font-medium">STOP LOSS</th>
                  <th className="pb-2 font-medium">TAKE PROFIT</th>
                  <th className="pb-2 font-medium text-right">ACTION</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {portfolio.positions.map((pos) => {
                  const isPositive = pos.unrealizedPnl >= 0;
                  return (
                    <tr key={pos.symbol} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-2.5 font-bold text-slate-100">{pos.symbol}</td>
                      <td className="py-2.5">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            pos.direction === 'LONG'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-rose-500/20 text-rose-300'
                          }`}
                        >
                          {pos.direction}
                        </span>
                      </td>
                      <td className="py-2.5 text-slate-300">{pos.quantity}</td>
                      <td className="py-2.5 text-slate-300">${pos.entryPrice.toLocaleString()}</td>
                      <td className="py-2.5 font-bold text-slate-100">${pos.currentPrice.toLocaleString()}</td>
                      <td className="py-2.5 text-slate-200">${pos.allocatedUsd.toLocaleString()}</td>
                      <td className="py-2.5">
                        <span className={`font-bold ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {isPositive ? '+' : ''}${pos.unrealizedPnl.toLocaleString()} ({isPositive ? '+' : ''}{pos.unrealizedPnlPct.toFixed(2)}%)
                        </span>
                      </td>
                      <td className="py-2.5 text-rose-400 text-[11px]">${pos.stopLossPrice.toLocaleString()}</td>
                      <td className="py-2.5 text-emerald-400 text-[11px]">${pos.takeProfitPrice.toLocaleString()}</td>
                      <td className="py-2.5 text-right">
                        <button
                          onClick={() => onClosePosition(pos.symbol)}
                          className="px-2 py-1 text-[10px] font-mono bg-rose-500/10 text-rose-400 border border-rose-500/30 rounded hover:bg-rose-500/20 transition-colors"
                        >
                          Market Exit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Execution Orders Log */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3 border-b border-slate-800 pb-2">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-blue-400" />
            <h3 className="text-xs font-bold font-mono text-slate-200 uppercase tracking-wider">
              Execution Orders &amp; Routing Fills ({orders.length})
            </h3>
          </div>
          <span className="text-[11px] font-mono text-slate-500">
            DMA / TWAP / VWAP / ICEBERG EXECUTION LOG
          </span>
        </div>

        {orders.length === 0 ? (
          <div className="p-6 text-center text-slate-500 font-mono text-xs">
            No executed orders logged yet this session.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-60 overflow-y-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-[11px]">
                  <th className="pb-2 font-medium">ORDER ID</th>
                  <th className="pb-2 font-medium">TIME</th>
                  <th className="pb-2 font-medium">SYMBOL</th>
                  <th className="pb-2 font-medium">SIDE</th>
                  <th className="pb-2 font-medium">QTY</th>
                  <th className="pb-2 font-medium">FILL PRICE</th>
                  <th className="pb-2 font-medium">SLIPPAGE</th>
                  <th className="pb-2 font-medium">EXCHANGE FEE</th>
                  <th className="pb-2 font-medium">ROUTING ALGO</th>
                  <th className="pb-2 font-medium">STATUS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {orders.slice(0, 15).map((ord) => (
                  <tr key={ord.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-2 text-slate-400">{ord.id}</td>
                    <td className="py-2 text-slate-500 text-[10px]">
                      {new Date(ord.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="py-2 font-bold text-slate-100">{ord.symbol}</td>
                    <td className="py-2">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          ord.side === 'BUY'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-rose-500/20 text-rose-300'
                        }`}
                      >
                        {ord.side}
                      </span>
                    </td>
                    <td className="py-2 text-slate-200">{ord.quantity}</td>
                    <td className="py-2 font-bold text-slate-100">${ord.filledPrice.toLocaleString()}</td>
                    <td className="py-2 text-amber-400">{ord.slippageBps} bps</td>
                    <td className="py-2 text-slate-400">${ord.feeUsd.toFixed(2)}</td>
                    <td className="py-2 text-blue-400 text-[11px] font-semibold">{ord.executionRoute}</td>
                    <td className="py-2">
                      <span className="text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded text-[10px]">
                        {ord.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
