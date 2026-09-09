import React from 'react';
import { TrendingUp, TrendingDown, DollarSign, ShieldAlert, BarChart3, Activity, PieChart } from 'lucide-react';
import { PortfolioState, Position } from '../types/trading';

interface PortfolioStatsProps {
  portfolio: PortfolioState;
  onClosePosition: (symbol: string) => void;
}

export const PortfolioStats: React.FC<PortfolioStatsProps> = ({ portfolio, onClosePosition }) => {
  const isPnlPositive = portfolio.realizedPnl + portfolio.unrealizedPnl >= 0;
  const winRate = portfolio.totalTrades > 0
    ? Math.round((portfolio.winningTrades / portfolio.totalTrades) * 100)
    : 0;

  return (
    <div className="space-y-4">
      {/* Primary KPI Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* NAV Card */}
        <div className="bg-slate-900/90 border border-slate-800/80 rounded-xl p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
            <span>PORTFOLIO NAV</span>
            <DollarSign className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="text-xl font-bold font-mono text-white mt-1">
            ${portfolio.navUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className={`text-xs font-mono mt-1 flex items-center gap-1 ${portfolio.dailyPnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {portfolio.dailyPnlPct >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            <span>{portfolio.dailyPnlPct >= 0 ? '+' : ''}{portfolio.dailyPnlPct.toFixed(2)}% Today</span>
          </div>
        </div>

        {/* Realized & Unrealized PnL */}
        <div className="bg-slate-900/90 border border-slate-800/80 rounded-xl p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
            <span>TOTAL PnL</span>
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className={`text-xl font-bold font-mono mt-1 ${isPnlPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
            {isPnlPositive ? '+' : ''}${(portfolio.realizedPnl + portfolio.unrealizedPnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] font-mono text-slate-400 mt-1 flex justify-between">
            <span>Real: ${portfolio.realizedPnl.toFixed(0)}</span>
            <span>Unreal: ${portfolio.unrealizedPnl.toFixed(0)}</span>
          </div>
        </div>

        {/* Gross & Net Leverage */}
        <div className="bg-slate-900/90 border border-slate-800/80 rounded-xl p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
            <span>GROSS LEVERAGE</span>
            <PieChart className="w-3.5 h-3.5 text-indigo-400" />
          </div>
          <div className="text-xl font-bold font-mono text-white mt-1">
            {portfolio.grossLeverage.toFixed(2)}x
          </div>
          <div className="text-[11px] font-mono text-slate-400 mt-1 flex items-center justify-between">
            <span>Net: {portfolio.netLeverage.toFixed(2)}x</span>
            <span className="text-cyan-400">Max: 3.00x</span>
          </div>
        </div>

        {/* Sharpe & Sortino */}
        <div className="bg-slate-900/90 border border-slate-800/80 rounded-xl p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
            <span>SHARPE / SORTINO</span>
            <BarChart3 className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="text-xl font-bold font-mono text-white mt-1">
            2.84 <span className="text-xs text-slate-400 font-normal">/ 3.42</span>
          </div>
          <div className="text-[11px] font-mono text-slate-400 mt-1">
            Win Rate: <span className="text-emerald-400">{winRate}%</span> ({portfolio.winningTrades}/{portfolio.totalTrades})
          </div>
        </div>

        {/* 99% CVaR Tail Risk */}
        <div className="bg-slate-900/90 border border-slate-800/80 rounded-xl p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
            <span>99% 1D CVaR</span>
            <ShieldAlert className="w-3.5 h-3.5 text-purple-400" />
          </div>
          <div className="text-xl font-bold font-mono text-purple-300 mt-1">
            ${portfolio.cvar99Usd.toLocaleString()}
          </div>
          <div className="text-[11px] font-mono text-slate-400 mt-1 flex justify-between">
            <span>VaR: ${portfolio.var99Usd.toLocaleString()}</span>
            <span className="text-purple-400">Budget: $25k</span>
          </div>
        </div>

        {/* Peak-to-Trough Drawdown */}
        <div className="bg-slate-900/90 border border-slate-800/80 rounded-xl p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
            <span>PEAK DRAWDOWN</span>
            <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
          </div>
          <div className="text-xl font-bold font-mono text-rose-300 mt-1">
            -{portfolio.currentDrawdownPct.toFixed(2)}%
          </div>
          <div className="text-[11px] font-mono text-slate-400 mt-1 flex justify-between">
            <span>Max DD: -{portfolio.maxDrawdownPct.toFixed(2)}%</span>
            <span className="text-rose-400">Stop: -6.0%</span>
          </div>
        </div>
      </div>

      {/* Active Positions Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="px-4 py-2.5 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
            <h3 className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wider">
              ACTIVE PORTFOLIO POSITIONS ({portfolio.positions.length})
            </h3>
          </div>
          <span className="text-[11px] font-mono text-slate-400">
            Available Free Cash: ${portfolio.cashUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-slate-800/80 text-slate-400 bg-slate-950/30 text-[11px]">
                <th className="py-2 px-4">SYMBOL</th>
                <th className="py-2 px-3">SIDE</th>
                <th className="py-2 px-3">QUANTITY</th>
                <th className="py-2 px-3">ENTRY PRICE</th>
                <th className="py-2 px-3">MARK PRICE</th>
                <th className="py-2 px-3">ALLOCATION</th>
                <th className="py-2 px-3">UNREALIZED PnL</th>
                <th className="py-2 px-3">STOP / TAKE</th>
                <th className="py-2 px-4 text-right">ACTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {portfolio.positions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-6 text-slate-500 font-sans text-xs">
                    No active positions. Swarm agents are scanning liquidity pools...
                  </td>
                </tr>
              ) : (
                portfolio.positions.map((pos) => {
                  const isProfit = pos.unrealizedPnl >= 0;
                  return (
                    <tr key={pos.symbol} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-2.5 px-4 font-bold text-white">{pos.symbol}</td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            pos.direction === 'LONG'
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                          }`}
                        >
                          {pos.direction}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-300">{pos.quantity}</td>
                      <td className="py-2.5 px-3 text-slate-300">${pos.entryPrice.toLocaleString()}</td>
                      <td className="py-2.5 px-3 text-slate-200 font-semibold">${pos.currentPrice.toLocaleString()}</td>
                      <td className="py-2.5 px-3 text-slate-400">${pos.allocatedUsd.toLocaleString()}</td>
                      <td className="py-2.5 px-3 font-semibold">
                        <span className={isProfit ? 'text-emerald-400' : 'text-rose-400'}>
                          {isProfit ? '+' : ''}${pos.unrealizedPnl.toFixed(2)} ({isProfit ? '+' : ''}{pos.unrealizedPnlPct.toFixed(2)}%)
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-[10px] text-slate-400">
                        <div>SL: ${pos.stopLossPrice.toFixed(2)}</div>
                        <div className="text-cyan-400">TP: ${pos.takeProfitPrice.toFixed(2)}</div>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          onClick={() => onClosePosition(pos.symbol)}
                          className="px-2 py-1 bg-slate-800 hover:bg-rose-900/50 text-slate-300 hover:text-rose-300 border border-slate-700 hover:border-rose-700/50 rounded text-[10px] transition-colors"
                        >
                          Close Market
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
