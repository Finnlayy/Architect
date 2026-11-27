import React from 'react';
import { Volume2, RefreshCw, Clock, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import {
  KeyTakeawayReport,
  KeyTakeawayTradeRecommendation,
} from '../types/terminal';

interface StudioKeyTakeawayDeckProps {
  report: KeyTakeawayReport | null;
  isGenerating: boolean;
  autoEvery30m: boolean;
  countdownSec: number;
  errorMsg: string | null;
  onToggleAuto: () => void;
  onTriggerNow: () => void;
  onSpeakCurrent: () => void;
  onSelectSymbol: (symbol: string) => void;
  onSpeakSingleSetup: (rec: KeyTakeawayTradeRecommendation) => void;
}

function formatMmSs(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

export const StudioKeyTakeawayDeck: React.FC<StudioKeyTakeawayDeckProps> = ({
  report,
  isGenerating,
  autoEvery30m,
  countdownSec,
  errorMsg,
  onToggleAuto,
  onTriggerNow,
  onSpeakCurrent,
  onSelectSymbol,
  onSpeakSingleSetup,
}) => {
  const biasColor =
    report?.forecastBias === 'BULLISH'
      ? 'text-[#089981]'
      : report?.forecastBias === 'BEARISH'
      ? 'text-[#F23645]'
      : 'text-[#F59E0B]';

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-3 space-y-2.5 bg-[#0B0F15]">
      {/* Top Broadcast Scheduler & Action Bar */}
      <div className="flex items-center justify-between gap-2 flex-wrap border-b border-[#1E2634] pb-2">
        <div className="flex items-center gap-2.5 text-[11px] font-mono tabular-nums flex-wrap">
          <span className="font-bold text-[#F59E0B] uppercase tracking-wider">
            30-MIN KEY TAKEAWAY &amp; PROGNOSE
          </span>
          {report && (
            <>
              <span className="text-[#566173]" aria-hidden="true">·</span>
              <span className={`font-bold flex items-center gap-1 ${biasColor}`}>
                {report.forecastBias === 'BULLISH' ? (
                  <TrendingUp className="w-3 h-3" />
                ) : report.forecastBias === 'BEARISH' ? (
                  <TrendingDown className="w-3 h-3" />
                ) : (
                  <Minus className="w-3 h-3" />
                )}
                <span>
                  {report.forecastBias} ({report.marketRegime})
                </span>
              </span>
              <span className="text-[#566173]" aria-hidden="true">·</span>
              <span className="text-[#8B95A5]">Stand {report.timeFormatted}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5 font-mono tabular-nums text-[10px] shrink-0">
          <span className="px-2 py-1 bg-[#07090E] border border-[#1E2634] text-[#8B95A5] flex items-center gap-1 whitespace-nowrap">
            <Clock className="w-3 h-3 text-[#F59E0B]" />
            <span>Nächste in {formatMmSs(countdownSec)}</span>
          </span>

          <button
            type="button"
            onClick={onToggleAuto}
            className={`px-2 py-1 border font-bold whitespace-nowrap transition-colors ${
              autoEvery30m
                ? 'border-[#089981] bg-[#089981]/15 text-[#089981]'
                : 'border-[#263042] bg-[#07090E] text-[#8B95A5]'
            }`}
          >
            AUTO 30M: {autoEvery30m ? 'AN' : 'AUS'}
          </button>

          {report && (
            <button
              type="button"
              onClick={onSpeakCurrent}
              title="Aktuellen 30-Minuten Bericht erneut durchsagen"
              className="px-2 py-1 border border-[#263042] bg-[#07090E] hover:border-[#00E5FF] text-[#00E5FF] font-bold flex items-center gap-1 whitespace-nowrap"
            >
              <Volume2 className="w-3 h-3" />
              <span>DURCHSAGE</span>
            </button>
          )}

          <button
            type="button"
            disabled={isGenerating}
            onClick={onTriggerNow}
            className="px-2.5 py-1 border border-[#F59E0B] bg-[#F59E0B]/15 hover:bg-[#F59E0B]/25 text-[#F59E0B] font-bold flex items-center gap-1 whitespace-nowrap disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${isGenerating ? 'animate-spin' : ''}`} />
            <span>{isGenerating ? 'ANALYSE…' : 'JETZT SENDEN'}</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="px-2.5 py-1.5 bg-[#1A1012] border border-[#F23645]/40 text-[11px] font-mono text-[#FCA5A5]">
          {errorMsg}
        </div>
      )}

      {!report ? (
        <div className="p-4 bg-[#07090E] border border-[#1E2634] flex items-center justify-between gap-3">
          <div className="text-xs font-mono text-[#8B95A5]">
            {isGenerating
              ? 'Erstelle datenbasierte 30-Minuten Prognose mit 5 konkreten Trade-Vorschlägen aus Screener, Pionex, CMC & News…'
              : 'Noch kein 30-Minuten Key Takeaway Bericht erstellt. Klicke auf „JETZT SENDEN“ für den sofortigen Live-Bericht.'}
          </div>
          {!isGenerating && (
            <button
              type="button"
              onClick={onTriggerNow}
              className="px-3 py-1.5 border border-[#F59E0B] bg-[#F59E0B]/15 text-[#F59E0B] text-[10px] font-mono font-bold whitespace-nowrap shrink-0"
            >
              BERICHT ERSTELLEN
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Forecast + Top Movers + Headlines Split */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5">
            <div className="lg:col-span-7 p-2.5 bg-[#07090E] border border-[#1E2634] space-y-1.5">
              <div className="flex items-center justify-between text-[10px] font-mono text-[#8B95A5]">
                <span className="font-bold text-[#E6EDF3] uppercase">
                  Prognose nächste 30 Minuten
                </span>
                <span>{report.generatedBy === 'gemini' ? 'Gemini Analyst' : 'Quant Desk'}</span>
              </div>
              <p className="text-xs text-[#E6EDF3] leading-relaxed">
                {report.forecast30mSummary}
              </p>
              {report.keyHeadlines.length > 0 && (
                <div className="pt-1.5 border-t border-[#1E2634] space-y-1">
                  {report.keyHeadlines.slice(0, 3).map((hl, idx) => (
                    <div
                      key={`hl-${idx}`}
                      className="text-[10px] font-mono text-[#8B95A5] truncate"
                      title={hl.title}
                    >
                      <span className="text-[#F59E0B] font-bold">{hl.source}</span>
                      {' · '}
                      <span className="text-[#00E5FF]">{hl.symbol}</span>
                      {' · '}
                      <span className="text-[#C9D1D9]">{hl.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="lg:col-span-5 p-2.5 bg-[#07090E] border border-[#1E2634] space-y-1.5">
              <div className="text-[10px] font-mono font-bold text-[#E6EDF3] uppercase">
                Top Symbol-Changes (Live)
              </div>
              <div className="divide-y divide-[#1E2634] font-mono tabular-nums text-[11px]">
                {report.topMoversSummary.slice(0, 5).map((m) => (
                  <button
                    key={m.symbol}
                    type="button"
                    onClick={() => onSelectSymbol(m.symbol)}
                    className="w-full py-1 flex items-center justify-between gap-2 hover:bg-[#131924] text-left px-1"
                  >
                    <div className="min-w-0 truncate">
                      <span className="font-bold text-[#E6EDF3]">{m.symbol}</span>
                      <span className="text-[9px] text-[#8B95A5] ml-2">{m.note}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[#8B95A5]">
                        ${m.price >= 100 ? m.price.toFixed(0) : m.price.toFixed(4)}
                      </span>
                      <span
                        className={`font-bold ${
                          m.changePct >= 0 ? 'text-[#089981]' : 'text-[#F23645]'
                        }`}
                      >
                        {m.changePct >= 0 ? '+' : ''}
                        {m.changePct.toFixed(2)}%
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 5 Concrete Trade Recommendations */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px] font-mono text-[#8B95A5]">
              <span className="font-bold text-[#00E5FF] uppercase">
                5 Konkrete Trade-Empfehlungen (Nächste 30 Min)
              </span>
              <span>Klick lädt Symbol in den Live-Chart</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2">
              {report.recommendations.slice(0, 5).map((rec) => {
                const isLong = rec.direction === 'LONG';
                return (
                  <div
                    key={`rec-${rec.rank}-${rec.symbol}`}
                    onClick={() => onSelectSymbol(rec.symbol)}
                    className="p-2.5 bg-[#07090E] border border-[#1E2634] hover:border-[#37455C] cursor-pointer flex flex-col justify-between gap-1.5 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-1 font-mono tabular-nums text-[11px]">
                      <span className="font-bold text-[#E6EDF3] truncate">
                        #{rec.rank} {rec.symbol}
                      </span>
                      <span
                        className={`text-[10px] font-bold shrink-0 ${
                          isLong ? 'text-[#089981]' : 'text-[#F23645]'
                        }`}
                      >
                        {rec.direction} · {rec.confidence}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] font-mono tabular-nums border-y border-[#1E2634] py-1">
                      <span className="text-[#8B95A5]">Entry</span>
                      <span className="text-right text-[#E6EDF3] font-bold">{rec.entryPrice}</span>
                      <span className="text-[#8B95A5]">Stop</span>
                      <span className="text-right text-[#F23645]">{rec.stopLoss}</span>
                      <span className="text-[#8B95A5]">Target</span>
                      <span className="text-right text-[#089981] font-bold">{rec.takeProfit}</span>
                      <span className="text-[#8B95A5]">R:R</span>
                      <span className="text-right text-[#00E5FF]">{rec.riskRewardRatio}</span>
                    </div>

                    <div className="flex items-end justify-between gap-1.5">
                      <p className="text-[10px] text-[#8B95A5] leading-snug line-clamp-2">
                        {rec.catalyst}
                      </p>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSpeakSingleSetup(rec);
                        }}
                        title="Dieses Trade-Setup live vorlesen"
                        className="p-1 border border-[#263042] hover:border-[#F59E0B] text-[#8B95A5] hover:text-[#F59E0B] shrink-0"
                      >
                        <Volume2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
