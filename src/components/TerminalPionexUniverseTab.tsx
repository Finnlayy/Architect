import React, { useMemo, useState } from 'react';
import {
  CmcIntelligencePayload,
  FinanceNewsItem,
  FinanceNewsPayload,
  PionexMarketTicker,
  PionexUniversePayload,
} from '../types/terminal';
import { voiceCommentatorService } from '../services/voiceCommentatorService';
import {
  ExternalLink,
  Newspaper,
  Radar,
  RefreshCw,
  Search,
  Terminal,
  Volume2,
} from 'lucide-react';

interface TerminalPionexUniverseTabProps {
  pionexData: PionexUniversePayload | null;
  newsData: FinanceNewsPayload | null;
  cmcData: CmcIntelligencePayload | null;
  isLoadingPionex: boolean;
  isLoadingNews: boolean;
  activeSymbol: string;
  onSelectSymbol: (symbol: string) => void;
  onScanPionex: () => void;
  onRefreshNews: () => void;
}

type MarketFilter = 'ALL' | 'SPOT' | 'PERP' | 'ANOMALIES';
type NewsFilter = 'ALL' | 'YAHOO_FINANCE' | 'MSN_FINANCE';

function formatUsdCompact(val: number): string {
  if (!Number.isFinite(val) || val <= 0) return '$0';
  if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
  if (val >= 1e3) return `$${(val / 1e3).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

function formatPrice(val: number): string {
  if (!Number.isFinite(val)) return '0.00';
  if (val < 0.001) return val.toFixed(7);
  if (val < 0.1) return val.toFixed(5);
  if (val < 10) return val.toFixed(4);
  if (val < 1000) return val.toFixed(2);
  return val.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function isSafeHttpsUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

export const TerminalPionexUniverseTab: React.FC<TerminalPionexUniverseTabProps> = ({
  pionexData,
  newsData,
  cmcData,
  isLoadingPionex,
  isLoadingNews,
  activeSymbol,
  onSelectSymbol,
  onScanPionex,
  onRefreshNews,
}) => {
  const [marketFilter, setMarketFilter] = useState<MarketFilter>('ALL');
  const [newsFilter, setNewsFilter] = useState<NewsFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<'VOLUME' | 'CHANGE' | 'RVOL'>('VOLUME');

  const filteredTickers = useMemo(() => {
    const raw = pionexData?.tickers || [];
    const q = searchQuery.trim().toLowerCase();

    const filtered = raw.filter((t) => {
      if (marketFilter === 'SPOT' && t.marketType !== 'SPOT') return false;
      if (marketFilter === 'PERP' && t.marketType !== 'PERP') return false;
      if (marketFilter === 'ANOMALIES' && t.signalTag === 'NORMAL') return false;
      if (q) {
        return (
          t.symbol.toLowerCase().includes(q) ||
          t.canonicalSymbol.toLowerCase().includes(q) ||
          t.baseAsset.toLowerCase().includes(q)
        );
      }
      return true;
    });

    const sorted = [...filtered];
    if (sortBy === 'CHANGE') {
      sorted.sort((a, b) => Math.abs(b.change24hPct) - Math.abs(a.change24hPct));
    } else if (sortBy === 'RVOL') {
      sorted.sort((a, b) => b.rvolScore - a.rvolScore);
    } else {
      sorted.sort((a, b) => b.amount24hUsd - a.amount24hUsd);
    }

    return sorted.slice(0, 220);
  }, [pionexData, marketFilter, searchQuery, sortBy]);

  const filteredNews = useMemo(() => {
    const items = newsData?.items || [];
    if (newsFilter === 'ALL') return items;
    return items.filter((i) => i.provider === newsFilter);
  }, [newsData, newsFilter]);

  return (
    <div className="h-full flex flex-col bg-[#0C1017] text-[#E6EDF3] overflow-hidden">
      {/* Top Status & Telemetry Bar */}
      <div className="px-3 py-1.5 bg-[#07090E] border-b border-[#1B2230] flex items-center justify-between gap-3 flex-wrap shrink-0">
        <div className="flex items-center gap-3 text-[10px] font-mono tabular-nums flex-wrap">
          <div className="flex items-center gap-1.5 text-[#F97316] font-bold">
            <Radar className="w-3.5 h-3.5" />
            <span>PIONEX USDT UNIVERSUM</span>
          </div>

          <span className="text-[#566173]" aria-hidden="true">·</span>

          <span className="flex items-center gap-1 text-[#8B95A5]">
            <Terminal className="w-3 h-3 text-[#089981]" />
            <span>
              @pionex/pionex-ai-kit{' '}
              <strong className="text-[#089981]">
                {pionexData?.aiKitInstalled
                  ? `v${pionexData.aiKitVersion || '0.2.55'}`
                  : 'AKTIV'}
              </strong>
              {pionexData?.aiKitGlobalCliReady ? ' · CLI/MCP bereit' : ''}
            </span>
          </span>

          <span className="text-[#566173]" aria-hidden="true">·</span>

          <span className="text-[#8B95A5]">
            Märkte:{' '}
            <strong className="text-[#E6EDF3]">
              {pionexData?.totalUsdtMarkets ?? 0} USDT
            </strong>{' '}
            ({pionexData?.spotCount ?? 0} Spot / {pionexData?.perpCount ?? 0} Perp)
          </span>

          <span className="text-[#566173]" aria-hidden="true">·</span>

          <span className="text-[#8B95A5]">
            24h Vol:{' '}
            <strong className="text-[#00E5FF]">
              {formatUsdCompact(pionexData?.totalVolume24hUsd ?? 0)}
            </strong>
          </span>

          <span className="text-[#566173]" aria-hidden="true">·</span>

          <span className="text-[#8B95A5]">
            Anomalien:{' '}
            <strong className="text-[#F59E0B]">{pionexData?.anomaliesCount ?? 0}</strong>
          </span>

          <span className="text-[#566173]" aria-hidden="true">·</span>

          <span className="text-[#8B95A5]">
            News:{' '}
            <strong className="text-[#C084FC]">{newsData?.yahooCount ?? 0} Yahoo</strong> /{' '}
            <strong className="text-[#38BDF8]">{newsData?.msnCount ?? 0} MSN</strong>
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onScanPionex}
            disabled={isLoadingPionex}
            className="px-2 py-0.5 bg-[#F97316]/15 hover:bg-[#F97316]/25 border border-[#F97316] text-[#F97316] text-[10px] font-mono font-bold flex items-center gap-1 whitespace-nowrap"
          >
            <RefreshCw className={`w-3 h-3 ${isLoadingPionex ? 'animate-spin' : ''}`} />
            <span>JETZT SCANNEN</span>
          </button>
          <button
            type="button"
            onClick={onRefreshNews}
            disabled={isLoadingNews}
            className="px-2 py-0.5 bg-[#0C1017] hover:border-[#38BDF8] border border-[#1B2230] text-[#38BDF8] text-[10px] font-mono font-bold flex items-center gap-1 whitespace-nowrap"
          >
            <Newspaper className={`w-3 h-3 ${isLoadingNews ? 'animate-spin' : ''}`} />
            <span>NEWS AKTUALISIEREN</span>
          </button>
        </div>
      </div>

      {/* Main Split Body: 8 cols Pionex USDT Table + 4 cols Yahoo/MSN Finance News */}
      <div className="flex-1 grid grid-cols-1 xl:grid-cols-12 min-h-0 overflow-hidden">
        {/* LEFT: All Active Pionex USDT Markets */}
        <div className="xl:col-span-8 flex flex-col min-h-0 border-r border-[#1B2230]">
          {/* Controls Toolbar */}
          <div className="px-3 py-1.5 bg-[#090D14] border-b border-[#1B2230] flex items-center justify-between gap-2 flex-wrap shrink-0">
            <div className="flex items-center gap-1">
              {(
                [
                  { id: 'ALL', label: `ALLE USDT (${pionexData?.totalUsdtMarkets ?? 0})` },
                  { id: 'SPOT', label: `SPOT (${pionexData?.spotCount ?? 0})` },
                  { id: 'PERP', label: `PERP (${pionexData?.perpCount ?? 0})` },
                  { id: 'ANOMALIES', label: `ANOMALIEN (${pionexData?.anomaliesCount ?? 0})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setMarketFilter(tab.id)}
                  className={`px-2 py-0.5 text-[10px] font-mono border whitespace-nowrap ${
                    marketFilter === tab.id
                      ? 'border-[#F97316] bg-[#F97316]/15 text-[#F97316] font-bold'
                      : 'border-[#1B2230] bg-[#0C1017] text-[#8B95A5] hover:text-[#E6EDF3]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 text-[10px] font-mono">
                <span className="text-[#566173]">SORT:</span>
                {(['VOLUME', 'CHANGE', 'RVOL'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setSortBy(mode)}
                    className={`px-1.5 py-0.5 border text-[9px] ${
                      sortBy === mode
                        ? 'border-[#00E5FF] text-[#00E5FF] bg-[#00E5FF]/10 font-bold'
                        : 'border-[#1B2230] text-[#8B95A5] hover:text-[#E6EDF3]'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>

              <div className="relative">
                <Search className="w-3 h-3 text-[#566173] absolute left-2 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Pionex Paar suchen..."
                  className="bg-[#0C1017] border border-[#1B2230] pl-6 pr-2 py-0.5 text-[11px] font-mono text-[#E6EDF3] w-44 focus:outline-none focus:border-[#F97316]"
                />
              </div>
            </div>
          </div>

          {/* High-Density USDT Table */}
          <div className="flex-1 overflow-y-auto">
            {filteredTickers.length === 0 ? (
              <div className="p-6 text-center text-xs font-mono text-[#8B95A5] space-y-2">
                <div>
                  {isLoadingPionex
                    ? 'Scanne alle aktiven Pionex USDT-Märkte…'
                    : 'Keine passenden Pionex USDT-Märkte gefunden.'}
                </div>
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setMarketFilter('ALL');
                    }}
                    className="px-2.5 py-1 border border-[#1B2230] text-[#00E5FF] hover:border-[#00E5FF]"
                  >
                    Filter zurücksetzen
                  </button>
                )}
              </div>
            ) : (
              <table className="w-full text-left border-collapse font-mono tabular-nums text-[11px]">
                <thead className="sticky top-0 bg-[#07090E] border-b border-[#1B2230] text-[9px] text-[#8B95A5] uppercase z-10">
                  <tr>
                    <th className="py-1.5 px-2.5">PAAR / TYP</th>
                    <th className="py-1.5 px-2 text-right">PREIS</th>
                    <th className="py-1.5 px-2 text-right">24H %</th>
                    <th className="py-1.5 px-2 text-right">RANGE %</th>
                    <th className="py-1.5 px-2 text-right">24H VOL $</th>
                    <th className="py-1.5 px-2 text-right">RVOL</th>
                    <th className="py-1.5 px-2">SIGNAL</th>
                    <th className="py-1.5 px-2.5 text-right">VOICE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1B2230]/50">
                  {filteredTickers.map((t: PionexMarketTicker) => {
                    const isSelected =
                      t.canonicalSymbol.toUpperCase() === activeSymbol.toUpperCase() ||
                      t.symbol.toUpperCase() === activeSymbol.toUpperCase();
                    return (
                      <tr
                        key={t.symbol}
                        onClick={() => onSelectSymbol(t.canonicalSymbol)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-[#F97316]/15 text-[#E6EDF3]'
                            : 'hover:bg-[#131924] text-[#E6EDF3]'
                        }`}
                      >
                        <td className="py-1.5 px-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-[#F97316]">{t.canonicalSymbol}</span>
                            <span className="text-[9px] text-[#8B95A5]">
                              {t.marketType} · {t.symbol}
                            </span>
                          </div>
                        </td>
                        <td className="py-1.5 px-2 text-right font-semibold">
                          ${formatPrice(t.price)}
                        </td>
                        <td
                          className={`py-1.5 px-2 text-right font-bold ${
                            t.change24hPct >= 0 ? 'text-[#089981]' : 'text-[#F23645]'
                          }`}
                        >
                          {t.change24hPct >= 0 ? '+' : ''}
                          {t.change24hPct.toFixed(2)}%
                        </td>
                        <td className="py-1.5 px-2 text-right text-[#8B95A5]">
                          {t.rangePct.toFixed(1)}%
                        </td>
                        <td className="py-1.5 px-2 text-right text-[#E6EDF3]">
                          {formatUsdCompact(t.amount24hUsd)}
                        </td>
                        <td
                          className={`py-1.5 px-2 text-right ${
                            t.rvolScore >= 2.2 ? 'text-[#00E5FF] font-bold' : 'text-[#8B95A5]'
                          }`}
                        >
                          {t.rvolScore.toFixed(2)}x
                        </td>
                        <td className="py-1.5 px-2 text-[10px]">
                          {t.signalTag !== 'NORMAL' ? (
                            <span
                              className={
                                t.signalTag === 'TOP LOSER'
                                  ? 'text-[#F23645] font-bold'
                                  : 'text-[#F59E0B] font-bold'
                              }
                            >
                              {t.signalTag}
                            </span>
                          ) : (
                            <span className="text-[#566173]">—</span>
                          )}
                        </td>
                        <td className="py-1.5 px-2.5 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              voiceCommentatorService.enqueuePionexTicker(t, cmcData, true);
                            }}
                            title="Dieses Pionex-Paar sofort kommentieren"
                            className="px-1.5 py-0.5 border border-[#1B2230] hover:border-[#F97316] text-[#F97316] text-[9px] inline-flex items-center gap-1"
                          >
                            <Volume2 className="w-2.5 h-2.5" />
                            <span>ON AIR</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* RIGHT: Live MSN Finance & Yahoo Finance News Feed */}
        <div className="xl:col-span-4 flex flex-col min-h-0 bg-[#07090E]">
          <div className="px-3 py-1.5 bg-[#090D14] border-b border-[#1B2230] flex items-center justify-between gap-2 shrink-0">
            <span className="text-[10px] font-bold tracking-wider uppercase text-[#E6EDF3]">
              YAHOO &amp; MSN FINANCE NEWS ({filteredNews.length})
            </span>
            <div className="flex items-center gap-1">
              {(
                [
                  { id: 'ALL', label: 'ALLE' },
                  { id: 'YAHOO_FINANCE', label: 'YAHOO' },
                  { id: 'MSN_FINANCE', label: 'MSN' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setNewsFilter(tab.id)}
                  className={`px-1.5 py-0.5 text-[9px] font-mono border ${
                    newsFilter === tab.id
                      ? tab.id === 'MSN_FINANCE'
                        ? 'border-[#38BDF8] text-[#38BDF8] bg-[#38BDF8]/15 font-bold'
                        : tab.id === 'YAHOO_FINANCE'
                        ? 'border-[#A855F7] text-[#C084FC] bg-[#A855F7]/15 font-bold'
                        : 'border-[#00E5FF] text-[#00E5FF] bg-[#00E5FF]/15 font-bold'
                      : 'border-[#1B2230] text-[#8B95A5] hover:text-[#E6EDF3]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-[#1B2230]/60">
            {filteredNews.length === 0 ? (
              <div className="p-4 text-center text-xs font-mono text-[#8B95A5]">
                {isLoadingNews
                  ? 'Lade Yahoo Finance & MSN Finance Headlines…'
                  : 'Aktuell keine Meldungen im Filter.'}
              </div>
            ) : (
              filteredNews.map((item: FinanceNewsItem) => (
                <div
                  key={item.id}
                  className="p-2.5 hover:bg-[#0C1017] transition-colors space-y-1"
                >
                  <div className="flex items-center justify-between gap-2 text-[10px] font-mono tabular-nums">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[#8B95A5]">{item.timeFormatted}</span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={
                          item.provider === 'YAHOO_FINANCE'
                            ? 'text-[#C084FC] font-bold'
                            : 'text-[#38BDF8] font-bold'
                        }
                      >
                        {item.provider === 'YAHOO_FINANCE' ? 'YAHOO' : 'MSN'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="text-[#00E5FF] font-bold">{item.symbol}</span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          voiceCommentatorService.enqueueFinanceNews(item, cmcData, true)
                        }
                        title="News als DE/EN Key-Takeaway kommentieren"
                        className="px-1.5 py-0.5 border border-[#1B2230] hover:border-[#00E5FF] text-[#00E5FF] text-[9px] flex items-center gap-1"
                      >
                        <Volume2 className="w-2.5 h-2.5" />
                        <span>ON AIR</span>
                      </button>
                      {isSafeHttpsUrl(item.link) && (
                        <a
                          href={item.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Originalartikel öffnen"
                          className="p-1 border border-[#1B2230] hover:border-[#8B95A5] text-[#8B95A5] hover:text-[#E6EDF3]"
                        >
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                    </div>
                  </div>

                  <div
                    className={`text-xs font-semibold leading-snug ${
                      item.sentiment === 'BULLISH'
                        ? 'text-[#089981]'
                        : item.sentiment === 'BEARISH'
                        ? 'text-[#F23645]'
                        : 'text-[#E6EDF3]'
                    }`}
                  >
                    {item.title}
                  </div>
                  <p className="text-[11px] text-[#8B95A5] leading-snug line-clamp-2">
                    {item.summary}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
