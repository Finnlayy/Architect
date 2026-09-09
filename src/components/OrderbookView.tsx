import React, { useState } from 'react';
import {
  Layers,
  ArrowDownUp,
  Activity,
  BarChart2,
  Zap,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Radio,
  ShieldCheck,
  History,
} from 'lucide-react';
import { OrderbookData } from '../types/trading';

interface OrderbookViewProps {
  markets: Record<string, OrderbookData>;
  onOpenConnectionHistory?: () => void;
  krakenStatus?: {
    status: 'LIVE' | 'CONNECTING' | 'FALLBACK_REST' | 'OFFLINE';
    source: string;
    latencyMs: number;
    messagesCount: number;
    lastTickTime?: Date | null;
    onReconnect?: () => void;
    isRealData?: boolean;
    reconnectAttempt?: number;
    nextRetryDelayMs?: number | null;
  };
}

export const OrderbookView: React.FC<OrderbookViewProps> = ({ markets, onOpenConnectionHistory, krakenStatus }) => {
  const symbols = Object.keys(markets);
  const [activeSymbol, setActiveSymbol] = useState<string>(symbols[0] || 'BTC/USD');

  const book = markets[activeSymbol] || markets['BTC/USD'];
  if (!book) return null;

  const maxBidTotal = book.bids.length > 0 ? book.bids[book.bids.length - 1].total : 1;
  const maxAskTotal = book.asks.length > 0 ? book.asks[book.asks.length - 1].total : 1;
  const maxDepthTotal = Math.max(maxBidTotal, maxAskTotal, 0.001);

  // Microstructure Imbalance & VPIN estimates
  const topBidsVol = book.bids.slice(0, 5).reduce((acc, b) => acc + b.size, 0);
  const topAsksVol = book.asks.slice(0, 5).reduce((acc, a) => acc + a.size, 0);
  const imbalanceRatio = topBidsVol / Math.max(topAsksVol, 0.001);
  const vpinEstimate = Math.min(0.85, Math.abs(topBidsVol - topAsksVol) / (topBidsVol + topAsksVol + 0.001));

  const isLive = krakenStatus?.status === 'LIVE';

  return (
    <div className="space-y-4">
      {/* Live Kraken Market Stream Telemetry Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 font-mono text-xs">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400">
            <Radio className={`w-4 h-4 ${isLive ? 'text-emerald-400 animate-pulse' : 'text-amber-400'}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-100 uppercase tracking-wide">
                Kraken L2 Market Stream
              </span>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                  isLive
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                }`}
              >
                {isLive ? 'LIVE VERBUNDEN' : 'VERBINDE...'}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                {krakenStatus?.source === 'KRAKEN_WS_PORT_1000'
                  ? 'WebSocket (Port 1000)'
                  : krakenStatus?.source === 'KRAKEN_WS_DIRECT'
                  ? 'wss://ws.kraken.com/v2 (Direct DMA)'
                  : krakenStatus?.source === 'KRAKEN_SERVER_SSE'
                  ? 'Cloud Run Bridge (SSE EventStream)'
                  : 'Kraken Institutional API'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Deterministisches Orderbuch &amp; Level-2 Marktdaten in Echtzeit für Swarm-Signale und M8-Gate Slicer
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-right">
          <div className="bg-slate-950 px-2.5 py-1 rounded border border-slate-800 text-[11px]">
            <span className="text-slate-500">Latenz:</span>{' '}
            <span className="text-emerald-400 font-bold">{krakenStatus?.latencyMs ?? 1.2} ms</span>
          </div>
          <div className="bg-slate-950 px-2.5 py-1 rounded border border-slate-800 text-[11px]">
            <span className="text-slate-500">Ticks:</span>{' '}
            <span className="text-slate-200 font-bold">#{krakenStatus?.messagesCount ?? 0}</span>
          </div>
          {onOpenConnectionHistory && (
            <button
              onClick={onOpenConnectionHistory}
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition-colors text-xs font-mono"
              title="WebSocket Port 1000 Verbindungshistorie & Diagnostik öffnen"
            >
              <History className="w-3 h-3 text-amber-400" />
              <span>Diagnostik</span>
            </button>
          )}
          {krakenStatus?.onReconnect && (
            <button
              onClick={krakenStatus.onReconnect}
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1 transition-colors"
              title="Kraken Stream neu verbinden"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Neu verbinden</span>
            </button>
          )}
        </div>
      </div>

      {/* Symbol Tabs Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {symbols.map((sym) => {
            const m = markets[sym];
            const isSelected = activeSymbol === sym;
            return (
              <button
                key={sym}
                onClick={() => setActiveSymbol(sym)}
                className={`px-3 py-1.5 rounded text-xs font-mono font-bold transition-colors flex items-center gap-2 ${
                  isSelected
                    ? 'bg-slate-800 text-amber-400 border border-slate-700'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <span>{sym}</span>
                <span className="text-[11px] text-slate-100 font-normal">
                  ${m.lastPrice.toLocaleString()}
                </span>
              </button>
            );
          })}
        </div>

        {/* Microstructure Metrics Banner */}
        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-1 bg-slate-950 px-2.5 py-1 rounded border border-slate-800">
            <span className="text-slate-400">Spread:</span>
            <span className="text-slate-200 font-bold">${book.spread.toFixed(2)}</span>
            <span className="text-amber-400 text-[10px]">({book.spreadBps} bps)</span>
          </div>

          <div className="flex items-center gap-1 bg-slate-950 px-2.5 py-1 rounded border border-slate-800">
            <span className="text-slate-400">L2 Imbalance:</span>
            <span className={`font-bold ${imbalanceRatio > 1.2 ? 'text-emerald-400' : imbalanceRatio < 0.8 ? 'text-rose-400' : 'text-slate-200'}`}>
              {imbalanceRatio.toFixed(2)}
            </span>
          </div>

          <div className="flex items-center gap-1 bg-slate-950 px-2.5 py-1 rounded border border-slate-800">
            <span className="text-slate-400">VPIN Toxicity:</span>
            <span className={`font-bold ${vpinEstimate > 0.4 ? 'text-rose-400' : 'text-emerald-400'}`}>
              {vpinEstimate.toFixed(3)}
            </span>
          </div>
        </div>
      </div>

      {/* Main Orderbook & Recent Trades Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left: Level 2 Depth Orderbook (8 cols) */}
        <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3 border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-bold font-mono text-slate-200 uppercase tracking-wider">
                Level-2 Deep Orderbook ({book.symbol})
              </h3>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              24h Vol: ${(book.volume24h / 1000000).toFixed(1)}M
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Bids Column */}
            <div>
              <div className="flex justify-between text-[11px] font-mono text-slate-400 mb-2 border-b border-slate-800/80 pb-1">
                <span>TOTAL</span>
                <span>SIZE</span>
                <span className="text-emerald-400 font-bold">BID PRICE</span>
              </div>
              <div className="space-y-1">
                {book.bids.map((bid, idx) => {
                  const depthPct = (bid.total / maxDepthTotal) * 100;
                  return (
                    <div
                      key={`bid-${idx}`}
                      className="relative flex justify-between items-center text-xs font-mono py-1 px-1.5 rounded overflow-hidden"
                    >
                      <div
                        className="absolute right-0 top-0 bottom-0 bg-emerald-500/10 pointer-events-none"
                        style={{ width: `${depthPct}%` }}
                      />
                      <span className="relative z-10 text-slate-400 text-[10px]">{bid.total.toFixed(2)}</span>
                      <span className="relative z-10 text-slate-300 text-[11px]">{bid.size.toFixed(2)}</span>
                      <span className="relative z-10 text-emerald-400 font-bold">
                        ${bid.price.toLocaleString()}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Asks Column */}
            <div>
              <div className="flex justify-between text-[11px] font-mono text-slate-400 mb-2 border-b border-slate-800/80 pb-1">
                <span className="text-rose-400 font-bold">ASK PRICE</span>
                <span>SIZE</span>
                <span>TOTAL</span>
              </div>
              <div className="space-y-1">
                {book.asks.map((ask, idx) => {
                  const depthPct = (ask.total / maxDepthTotal) * 100;
                  return (
                    <div
                      key={`ask-${idx}`}
                      className="relative flex justify-between items-center text-xs font-mono py-1 px-1.5 rounded overflow-hidden"
                    >
                      <div
                        className="absolute left-0 top-0 bottom-0 bg-rose-500/10 pointer-events-none"
                        style={{ width: `${depthPct}%` }}
                      />
                      <span className="relative z-10 text-rose-400 font-bold">
                        ${ask.price.toLocaleString()}
                      </span>
                      <span className="relative z-10 text-slate-300 text-[11px]">{ask.size.toFixed(2)}</span>
                      <span className="relative z-10 text-slate-400 text-[10px]">{ask.total.toFixed(2)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Recent Trade Prints (4 cols) */}
        <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3 border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              <h3 className="text-xs font-bold font-mono text-slate-200 uppercase tracking-wider">
                Tick Feed
              </h3>
            </div>
            <span className="text-[10px] font-mono text-slate-500">REAL-TIME TRADES</span>
          </div>

          <div className="space-y-1.5 max-h-[380px] overflow-y-auto">
            {book.recentTrades.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between text-xs font-mono p-1.5 rounded bg-slate-950/70 border border-slate-800/50"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[9px] px-1 py-0.2 rounded font-bold ${
                      t.side === 'BUY'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-rose-500/20 text-rose-400'
                    }`}
                  >
                    {t.side}
                  </span>
                  <span className="text-slate-200 font-semibold">${t.price.toLocaleString()}</span>
                </div>

                <div className="flex items-center gap-2 text-slate-400 text-[11px]">
                  <span>{t.size}</span>
                  <span className="text-[10px] text-slate-500">
                    {new Date(t.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
