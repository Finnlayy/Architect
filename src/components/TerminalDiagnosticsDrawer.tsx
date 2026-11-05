import React from 'react';
import {
  DataProviderId,
  ProviderAttemptTrace,
  ScreenerScheduleStatus,
  BacktestResult,
} from '../types/terminal';
import { X, Server, CheckCircle2, Terminal } from 'lucide-react';

interface TerminalDiagnosticsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeProvider: DataProviderId;
  cascadeTrace: ProviderAttemptTrace[];
  screenerStatus: ScreenerScheduleStatus | null;
  backtestResult: BacktestResult | null;
  wsConnected: boolean;
  systemLogs: string[];
}

const CASCADE_ORDER: Array<{
  id: DataProviderId;
  rank: number;
  name: string;
  scope: string;
  endpoint: string;
}> = [
  {
    id: 'KRAKEN',
    rank: 1,
    name: 'Kraken Spot & Futures',
    scope: 'Primary Crypto Spot & Perpetuals (BTC/USD, ETH/USD, SOL/USD, AVAX/USD)',
    endpoint: 'api.kraken.com / demo-futures.kraken.com',
  },
  {
    id: 'CCXT',
    rank: 2,
    name: 'CCXT Unified Exchange Aggregator',
    scope: 'Perpetual Futures & Altcoins (PEPEUSDT.P, BTCUSDT.P, HYPE/USD)',
    endpoint: 'ccxt.pro multi-exchange router',
  },
  {
    id: 'GAINIUM',
    rank: 3,
    name: 'Gainium DCA & Grid Feed',
    scope: 'Bot-optimierte Liquiditäts-Paare (LINK/USD, DOGE/USD)',
    endpoint: 'api.gainium.io/v1/market',
  },
  {
    id: 'BINANCE',
    rank: 4,
    name: 'Binance USD-M & Spot',
    scope: 'High-Velocity Perps & Spot (ZECUSDT.P, SUIUSDT, XRPUSDT)',
    endpoint: 'fapi.binance.com / api.binance.com',
  },
  {
    id: 'ALPACA',
    rank: 5,
    name: 'Alpaca Markets SIP/IEX',
    scope: 'US-Aktien & Tech-Leader (NVDA, AAPL)',
    endpoint: 'data.alpaca.markets/v2/stocks',
  },
  {
    id: 'ALPHAVANTAGE',
    rank: 6,
    name: 'Alpha Vantage FX & Commodities',
    scope: 'Forex & Rohstoffe (EUR/USD, XAU/USD)',
    endpoint: 'alphavantage.co/query',
  },
];

export const TerminalDiagnosticsDrawer: React.FC<TerminalDiagnosticsDrawerProps> = ({
  isOpen,
  onClose,
  activeProvider,
  cascadeTrace,
  screenerStatus,
  wsConnected,
  systemLogs,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex justify-end select-none">
      <div className="w-full max-w-2xl bg-[#0C1017] border-l border-[#1B2230] h-full flex flex-col text-[#E6EDF3]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1B2230] bg-[#07090E]">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-[#00E5FF]" />
            <span className="text-xs font-bold tracking-wider uppercase">
              SYSTEM-DIAGNOSE & 6-STUFEN MARKTDATEN-KASKADE
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-[#8B95A5] hover:text-[#E6EDF3] border border-[#1B2230] bg-[#0C1017]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 font-mono text-xs">
          {/* 6-Stage Provider Cascade Architecture */}
          <div className="bg-[#07090E] border border-[#1B2230] p-3">
            <div className="text-[11px] font-semibold text-[#00E5FF] uppercase mb-2 flex items-center justify-between">
              <span>1. Deterministische 6-Provider Daten-Kaskade (Kein Synthetic-Fallback)</span>
              <span className="text-[#089981]">AKTIV: {activeProvider}</span>
            </div>
            <div className="space-y-1.5">
              {CASCADE_ORDER.map((p) => {
                const isCurrent = p.id === activeProvider;
                return (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between px-2.5 py-1.5 border ${
                      isCurrent
                        ? 'border-[#00E5FF]/60 bg-[#00E5FF]/10 text-[#E6EDF3]'
                        : 'border-[#1B2230] bg-[#0C1017] text-[#8B95A5]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-[#00E5FF]">#{p.rank}</span>
                        <span className="text-[11px] font-semibold text-[#E6EDF3]">{p.name}</span>
                        <span className="text-[9px] px-1 border border-[#263042] text-[#8B95A5]">
                          {p.id}
                        </span>
                      </div>
                      <div className="text-[10px] text-[#8B95A5] truncate mt-0.5">{p.scope}</div>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <span
                        className={`text-[10px] px-1.5 py-0.5 border ${
                          isCurrent
                            ? 'border-[#089981]/50 bg-[#089981]/15 text-[#089981]'
                            : 'border-[#263042] text-[#8B95A5]'
                        }`}
                      >
                        {isCurrent ? 'PRIMÄR AKTIV' : 'BEREIT (SCREENER)'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Last Cascade Trace */}
          <div className="bg-[#07090E] border border-[#1B2230] p-3">
            <div className="text-[11px] font-semibold text-[#E6EDF3] uppercase mb-1.5">
              2. Letzter Kaskaden-Abruf-Trace (Kraken → CCXT → Gainium → Binance → Alpaca → Alpha Vantage)
            </div>
            <div className="space-y-1 text-[11px] text-[#8B95A5]">
              {cascadeTrace.length > 0 ? (
                cascadeTrace.map((trace, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 border-b border-[#1B2230]/50 py-1">
                    <div className="flex items-center gap-2">
                      <CheckCircle2
                        className={`w-3 h-3 shrink-0 ${
                          trace.status === 'SUCCESS' ? 'text-[#089981]' : 'text-[#F59E0B]'
                        }`}
                      />
                      <span className="font-bold text-[#00E5FF]">{trace.provider}</span>
                      <span className="text-[#E6EDF3]">{trace.message}</span>
                    </div>
                    <span className="text-[10px] text-[#8B95A5] shrink-0">
                      {trace.latencyMs}ms · {trace.status}
                    </span>
                  </div>
                ))
              ) : (
                <div>Noch kein Kaskaden-Trace aufgezeichnet.</div>
              )}
            </div>
          </div>

          {/* Scheduled Multi-Source Screener Telemetry */}
          <div className="bg-[#07090E] border border-[#1B2230] p-3">
            <div className="text-[11px] font-semibold text-[#E6EDF3] uppercase mb-1.5 flex items-center justify-between">
              <span>3. Automatisierter Multi-Source Screener (Cron-Schedule)</span>
              <span className="text-[#089981]">
                {screenerStatus?.enabled ? `AKTIV (${screenerStatus.intervalSec}s)` : 'PAUSIERT'}
              </span>
            </div>
            {screenerStatus && (
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="bg-[#0C1017] p-2 border border-[#1B2230]">
                  <span className="text-[#8B95A5] block">Letzter Scan:</span>
                  <span className="text-[#E6EDF3]">
                    {new Date(screenerStatus.lastRunAt).toLocaleTimeString('de-DE')}
                  </span>
                </div>
                <div className="bg-[#0C1017] p-2 border border-[#1B2230]">
                  <span className="text-[#8B95A5] block">Gescannte Symbole (6 Quellen):</span>
                  <span className="text-[#00E5FF]">
                    {screenerStatus.tickers.length} Instrumente · {screenerStatus.totalRuns} Zyklen
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* System & Execution Logs */}
          <div className="bg-[#07090E] border border-[#1B2230] p-3">
            <div className="text-[11px] font-semibold text-[#E6EDF3] uppercase mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-[#00E5FF]" />
                4. Echtzeit-System- & Ausführungs-Protokoll
              </span>
              <span className={wsConnected ? 'text-[#089981]' : 'text-[#F59E0B]'}>
                Kraken WS: {wsConnected ? 'VERBUNDEN' : 'REST-POLLING'}
              </span>
            </div>
            <div className="max-h-56 overflow-y-auto space-y-1 bg-[#0C1017] p-2 border border-[#1B2230] text-[10px]">
              {systemLogs.map((log, index) => (
                <div key={index} className="text-[#8B95A5] border-b border-[#1B2230]/50 pb-0.5">
                  {log}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
