import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  OHLCVCandle,
  BacktestTrade,
  EquityCurvePoint,
  DataProviderId,
} from '../types/terminal';
import { OrderbookData } from '../types/trading';
import {
  computeVolumeFootprint,
  detectLatestSwingPoints,
  detectActiveFVGs,
  detectActiveOrderBlocks,
  buildOrderbookHeatmapBands,
  formatCompactVolume,
} from '../engine/chartMicrostructure';
import { AlertCircle, Eye, EyeOff, RotateCcw } from 'lucide-react';

export type ChartViewMode = 'PRICE' | 'EQUITY' | 'DRAWDOWN';

const SVG_W = 960;
const SVG_H = 310;
const PAD_LEFT = 12;
const PAD_RIGHT = 96;
const PAD_TOP = 16;
const PAD_BOTTOM = 30;
const PLOT_W = SVG_W - PAD_LEFT - PAD_RIGHT;
const PLOT_H = SVG_H - PAD_TOP - PAD_BOTTOM;
const RIGHT_AXIS_X = SVG_W - PAD_RIGHT;
const FOOTPRINT_MAX_W = 148;
const X_AXIS_Y = PAD_TOP + PLOT_H;
const DEFAULT_VISIBLE_BARS = 140;
const MIN_VISIBLE_BARS = 8;

export interface ChartOpenPaperPosition {
  pair: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  unrealizedPnl: number;
  qty: number;
  isBreakEven?: boolean;
}

interface TerminalWorkspaceChartProps {
  symbol: string;
  timeframe: string;
  provider: DataProviderId;
  candles: OHLCVCandle[];
  trades: BacktestTrade[];
  equityCurve: EquityCurvePoint[];
  initialCapital: number;
  selectedTradeId: string | null;
  onSelectTrade: (tradeId: string | null) => void;
  fastEmaPeriod: number;
  slowEmaPeriod: number;
  openPaperPositions?: ChartOpenPaperPosition[];
  liveOrderbook?: OrderbookData | null;
  broadcastMode?: boolean;
}

function calcEMA(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const ema: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    ema.push(values[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

export const TerminalWorkspaceChart: React.FC<TerminalWorkspaceChartProps> = React.memo(({
  symbol,
  timeframe,
  provider,
  candles,
  trades,
  equityCurve,
  initialCapital,
  selectedTradeId,
  onSelectTrade,
  fastEmaPeriod,
  slowEmaPeriod,
  openPaperPositions = [],
  liveOrderbook = null,
  broadcastMode = false,
}) => {
  const [viewModeState, setViewMode] = useState<ChartViewMode>('PRICE');
  const viewMode: ChartViewMode = broadcastMode ? 'PRICE' : viewModeState;
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hoveredBinIndex, setHoveredBinIndex] = useState<number | null>(null);
  const [showEma, setShowEma] = useState<boolean>(true);
  const [showVwap, setShowVwap] = useState<boolean>(true);
  const [showTradeMarkers, setShowTradeMarkers] = useState<boolean>(true);
  const [showPaperPositionLines, setShowPaperPositionLines] = useState<boolean>(true);
  const [showShadowEquity, setShowShadowEquity] = useState<boolean>(true);

  // Orderflow, POC, Volume Bars & Smart Money Concepts Toggles
  const [showVolumeBars, setShowVolumeBars] = useState<boolean>(true);
  const [showFootprint, setShowFootprint] = useState<boolean>(true);
  const [showPoc, setShowPoc] = useState<boolean>(true);
  const [showSwings, setShowSwings] = useState<boolean>(true);
  const [showFvg, setShowFvg] = useState<boolean>(true);
  const [showOrderblocks, setShowOrderblocks] = useState<boolean>(true);
  const [showOrderbookHeatmap, setShowOrderbookHeatmap] = useState<boolean>(true);

  // Viewport Zoom & Pan State (X-Axis Window + Right-Edge Offset + Y-Axis Zoom)
  const [windowBars, setWindowBars] = useState<number>(DEFAULT_VISIBLE_BARS);
  const [rightOffsetBars, setRightOffsetBars] = useState<number>(0);
  const [yZoomScale, setYZoomScale] = useState<number>(1);
  const [interactionMode, setInteractionMode] = useState<'NONE' | 'PAN' | 'Y_ZOOM' | 'INSPECT'>('NONE');
  const [isShiftHover, setIsShiftHover] = useState<boolean>(false);

  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const panStartRef = useRef<{
    clientX: number;
    startRightOffset: number;
    windowCount: number;
    totalCount: number;
  } | null>(null);
  const yZoomStartRef = useRef<{
    clientY: number;
    startScale: number;
  } | null>(null);
  const suppressNextClickRef = useRef<boolean>(false);

  const [inspectState, setInspectState] = useState<{
    index: number;
    relX: number;
    relY: number;
    wrapW: number;
    wrapH: number;
  } | null>(null);

  // Reset Zoom & Pan when switching Symbol or Timeframe
  useEffect(() => {
    setWindowBars(DEFAULT_VISIBLE_BARS);
    setRightOffsetBars(0);
    setYZoomScale(1);
    setInspectState(null);
    setInteractionMode('NONE');
  }, [symbol, timeframe]);

  const totalBars = candles ? candles.length : 0;
  const defaultWindowBars = totalBars > 0 ? Math.min(DEFAULT_VISIBLE_BARS, totalBars) : DEFAULT_VISIBLE_BARS;
  const minWindowBars = totalBars > 0 ? Math.min(MIN_VISIBLE_BARS, totalBars) : MIN_VISIBLE_BARS;
  const effectiveWindow =
    totalBars === 0 ? 0 : Math.max(minWindowBars, Math.min(windowBars, totalBars));
  const maxRightOffset = Math.max(0, totalBars - effectiveWindow);
  const effectiveRightOffset = Math.max(0, Math.min(maxRightOffset, Math.round(rightOffsetBars)));
  const endIndex = totalBars - effectiveRightOffset;
  const startIndex = Math.max(0, endIndex - effectiveWindow);

  const visibleCandles = useMemo(() => {
    if (!candles || candles.length === 0) return [];
    return candles.slice(startIndex, endIndex);
  }, [candles, startIndex, endIndex]);

  const offsetIndex = startIndex;

  const { fastEma, slowEma } = useMemo(() => {
    const closes = candles.map((c) => c.close);
    const f = calcEMA(closes, Math.max(2, fastEmaPeriod));
    const s = calcEMA(closes, Math.max(3, slowEmaPeriod));
    return {
      fastEma: f.slice(startIndex, endIndex),
      slowEma: s.slice(startIndex, endIndex),
    };
  }, [candles, fastEmaPeriod, slowEmaPeriod, startIndex, endIndex]);

  const visibleTrades = useMemo(() => {
    if (!visibleCandles.length) return [];
    const minTime = visibleCandles[0].time;
    const maxTime = visibleCandles[visibleCandles.length - 1].time;
    return trades.filter((t) => t.exitTime >= minTime && t.entryTime <= maxTime);
  }, [trades, visibleCandles]);

  const selectedTrade = useMemo(
    () => trades.find((t) => t.id === selectedTradeId) || null,
    [trades, selectedTradeId]
  );

  const formatPrice = (val: number) => {
    if (val < 0.01) return val.toFixed(6);
    if (val < 1) return val.toFixed(4);
    if (val < 100) return val.toFixed(3);
    return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // Price Mode Bounds (Auto-Fit on visible candles + Y-Axis Zoom scaling)
  const priceBounds = useMemo(() => {
    if (!visibleCandles.length) return { min: 0, max: 100 };
    let min = Infinity;
    let max = -Infinity;
    for (const c of visibleCandles) {
      if (c.low < min) min = c.low;
      if (c.high > max) max = c.high;
    }
    if (!broadcastMode && selectedTrade) {
      min = Math.min(min, selectedTrade.stopLossPrice, selectedTrade.takeProfitPrice);
      max = Math.max(max, selectedTrade.stopLossPrice, selectedTrade.takeProfitPrice);
    }
    if (!broadcastMode && showPaperPositionLines && openPaperPositions.length > 0) {
      for (const pos of openPaperPositions) {
        if (pos.entryPrice > 0) {
          min = Math.min(min, pos.entryPrice, pos.stopLossPrice, pos.takeProfitPrice);
          max = Math.max(max, pos.entryPrice, pos.stopLossPrice, pos.takeProfitPrice);
        }
      }
    }
    const range = Math.max(max - min, min * 0.005, 0.000001);
    const bottomPad = showVolumeBars ? 0.16 : 0.06;
    const baseMin = min - range * bottomPad;
    const baseMax = max + range * 0.06;
    if (Math.abs(yZoomScale - 1) < 0.001) {
      return { min: baseMin, max: baseMax };
    }
    const mid = (baseMin + baseMax) / 2;
    const halfSpan = ((baseMax - baseMin) / 2) / Math.max(0.25, Math.min(4, yZoomScale));
    return { min: mid - halfSpan, max: mid + halfSpan };
  }, [
    broadcastMode,
    visibleCandles,
    selectedTrade,
    showPaperPositionLines,
    openPaperPositions,
    showVolumeBars,
    yZoomScale,
  ]);

  const maxCandleVolume = useMemo(() => {
    let maxVol = 0;
    for (const c of visibleCandles) {
      if (c.volume > maxVol) maxVol = c.volume;
    }
    return maxVol;
  }, [visibleCandles]);

  // Microstructure & SMC Computations (Volume Footprint, POC/LVN, Swings, Active FVG & OB, Orderbook Heatmap)
  const footprintData = useMemo(
    () => computeVolumeFootprint(visibleCandles, priceBounds.min, priceBounds.max, 30),
    [visibleCandles, priceBounds.min, priceBounds.max]
  );

  const swingPoints = useMemo(
    () => detectLatestSwingPoints(visibleCandles, 3),
    [visibleCandles]
  );

  const activeFvgs = useMemo(
    () => detectActiveFVGs(visibleCandles, 6),
    [visibleCandles]
  );

  const activeOrderBlocks = useMemo(
    () => detectActiveOrderBlocks(visibleCandles, 4),
    [visibleCandles]
  );

  const hasLiveOrderbook = Boolean(
    liveOrderbook && liveOrderbook.bids?.length > 0 && liveOrderbook.asks?.length > 0
  );

  const heatmapBands = useMemo(() => {
    if (!hasLiveOrderbook) return [];
    return buildOrderbookHeatmapBands(liveOrderbook, priceBounds.min, priceBounds.max);
  }, [hasLiveOrderbook, liveOrderbook, priceBounds.min, priceBounds.max]);

  // Equity Mode Bounds
  const equityBounds = useMemo(() => {
    if (!equityCurve.length) return { min: initialCapital * 0.9, max: initialCapital * 1.1 };
    let min = initialCapital;
    let max = initialCapital;
    for (const pt of equityCurve) {
      min = Math.min(min, pt.equity);
      max = Math.max(max, pt.equity);
      if (showShadowEquity) {
        min = Math.min(min, pt.shadowEquity);
        max = Math.max(max, pt.shadowEquity);
      }
    }
    const range = Math.max(max - min, initialCapital * 0.02);
    return { min: min - range * 0.08, max: max + range * 0.08 };
  }, [equityCurve, initialCapital, showShadowEquity]);

  // Drawdown Mode Bounds
  const ddBounds = useMemo(() => {
    if (!equityCurve.length) return { maxDd: 5 };
    let maxDd = 1;
    for (const pt of equityCurve) {
      if (pt.drawdownPct > maxDd) maxDd = pt.drawdownPct;
    }
    return { maxDd: maxDd * 1.15 };
  }, [equityCurve]);

  const resolveSvgCoordsFromClient = useCallback(
    (clientX: number, clientY: number): { svgX: number; svgY: number } => {
      const svgEl = svgRef.current;
      if (!svgEl) return { svgX: PAD_LEFT, svgY: PAD_TOP };
      const ctm = svgEl.getScreenCTM();
      if (ctm) {
        const pt = svgEl.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        const transformed = pt.matrixTransform(ctm.inverse());
        return { svgX: transformed.x, svgY: transformed.y };
      }
      const rect = svgEl.getBoundingClientRect();
      return {
        svgX: ((clientX - rect.left) / Math.max(rect.width, 1)) * SVG_W,
        svgY: ((clientY - rect.top) / Math.max(rect.height, 1)) * SVG_H,
      };
    },
    []
  );

  const resolveCandleIndexFromClientX = useCallback(
    (clientX: number, clientY: number): number => {
      if (!visibleCandles.length) return 0;
      const { svgX } = resolveSvgCoordsFromClient(clientX, clientY);
      const clampedX = Math.max(PAD_LEFT, Math.min(RIGHT_AXIS_X, svgX));
      const ratio = (clampedX - PAD_LEFT) / Math.max(PLOT_W, 1);
      const idx = Math.round(ratio * Math.max(visibleCandles.length - 1, 0));
      return Math.max(0, Math.min(visibleCandles.length - 1, idx));
    },
    [visibleCandles.length, resolveSvgCoordsFromClient]
  );

  const handleResetChartZoom = useCallback(() => {
    setWindowBars(DEFAULT_VISIBLE_BARS);
    setRightOffsetBars(0);
    setYZoomScale(1);
    setInspectState(null);
  }, []);

  // Non-passive Wheel Zoom (Cursor-anchored X-Zoom on plot, Y-Zoom on right price axis)
  useEffect(() => {
    const wrapEl = chartWrapRef.current;
    if (!wrapEl) return;

    const handleNativeWheel = (e: WheelEvent) => {
      if (viewMode !== 'PRICE' || totalBars === 0) return;
      if (Math.abs(e.deltaY) < 0.01 && Math.abs(e.deltaX) < 0.01) return;

      e.preventDefault();
      e.stopPropagation();

      const { svgX } = resolveSvgCoordsFromClient(e.clientX, e.clientY);

      // Horizontal trackpad swipe pans horizontally when dominant
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.4 && Math.abs(e.deltaX) > 2) {
        const step = Math.max(1, Math.round(effectiveWindow * 0.08));
        const deltaBars = e.deltaX > 0 ? -step : step;
        setRightOffsetBars((prev) =>
          Math.max(0, Math.min(maxRightOffset, Math.round(prev) + deltaBars))
        );
        return;
      }

      // Over Right Price Axis (or Alt+Wheel): Y-Axis Price Zoom
      if (svgX >= RIGHT_AXIS_X || e.altKey) {
        const clampedDelta = Math.max(-120, Math.min(120, e.deltaY));
        const factor = Math.exp(-clampedDelta * 0.0024);
        setYZoomScale((prev) => Math.max(0.25, Math.min(4.0, Number((prev * factor).toFixed(3)))));
        return;
      }

      // Main Plot: Cursor-anchored X-Axis Zoom
      const pointerRatio = Math.max(0, Math.min(1, (svgX - PAD_LEFT) / Math.max(PLOT_W, 1)));
      const clampedDelta = Math.max(-120, Math.min(120, e.deltaY));
      const zoomFactor = Math.exp(clampedDelta * 0.0022);
      let nextWindow = Math.round(effectiveWindow * zoomFactor);

      if (nextWindow === effectiveWindow) {
        nextWindow = e.deltaY < 0 ? effectiveWindow - 1 : effectiveWindow + 1;
      }
      nextWindow = Math.max(minWindowBars, Math.min(totalBars, nextWindow));

      if (nextWindow === effectiveWindow) return;

      const currentStart = totalBars - effectiveRightOffset - effectiveWindow;
      const anchorBar = currentStart + pointerRatio * Math.max(1, effectiveWindow - 1);
      const nextStart = anchorBar - pointerRatio * Math.max(1, nextWindow - 1);
      const nextEnd = nextStart + nextWindow;
      let nextRightOffset = Math.round(totalBars - nextEnd);

      // Keep pinned to live edge when zooming while already anchored near right edge
      if (effectiveRightOffset === 0 && pointerRatio >= 0.88) {
        nextRightOffset = 0;
      }

      const nextMaxOffset = Math.max(0, totalBars - nextWindow);
      nextRightOffset = Math.max(0, Math.min(nextMaxOffset, nextRightOffset));

      setWindowBars(nextWindow);
      setRightOffsetBars(nextRightOffset);
    };

    wrapEl.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => {
      wrapEl.removeEventListener('wheel', handleNativeWheel);
    };
  }, [
    viewMode,
    totalBars,
    effectiveWindow,
    effectiveRightOffset,
    maxRightOffset,
    minWindowBars,
    resolveSvgCoordsFromClient,
  ]);

  // Global Window Mousemove/Mouseup for Pan, Y-Axis Zoom, and Shift+Click Inspector
  useEffect(() => {
    if (interactionMode === 'NONE') return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      if (interactionMode === 'INSPECT') {
        const wrap = chartWrapRef.current;
        if (!wrap) return;
        const rect = wrap.getBoundingClientRect();
        const idx = resolveCandleIndexFromClientX(e.clientX, e.clientY);
        setInspectState({
          index: idx,
          relX: Math.max(0, Math.min(rect.width, e.clientX - rect.left)),
          relY: Math.max(0, Math.min(rect.height, e.clientY - rect.top)),
          wrapW: rect.width,
          wrapH: rect.height,
        });
        return;
      }

      if (interactionMode === 'PAN' && panStartRef.current) {
        const svgEl = svgRef.current;
        if (!svgEl) return;
        const rect = svgEl.getBoundingClientRect();
        const plotPixelW = Math.max(1, (PLOT_W / SVG_W) * rect.width);
        const { clientX, startRightOffset, windowCount, totalCount } = panStartRef.current;
        const deltaX = e.clientX - clientX;
        if (Math.abs(deltaX) > 4) {
          suppressNextClickRef.current = true;
        }
        const pxPerBar = plotPixelW / Math.max(1, windowCount - 1);
        const shiftBars = Math.round(deltaX / Math.max(2, pxPerBar));
        const maxOffset = Math.max(0, totalCount - windowCount);
        setRightOffsetBars(Math.max(0, Math.min(maxOffset, startRightOffset + shiftBars)));
        return;
      }

      if (interactionMode === 'Y_ZOOM' && yZoomStartRef.current) {
        const { clientY, startScale } = yZoomStartRef.current;
        const deltaY = clientY - e.clientY; // drag up -> stretch candles vertically -> zoom in
        if (Math.abs(deltaY) > 3) {
          suppressNextClickRef.current = true;
        }
        const nextScale = Math.max(
          0.25,
          Math.min(4.0, Number((startScale * Math.exp(deltaY * 0.008)).toFixed(3)))
        );
        setYZoomScale(nextScale);
      }
    };

    const handleWindowMouseUp = () => {
      setInspectState(null);
      setInteractionMode('NONE');
      panStartRef.current = null;
      yZoomStartRef.current = null;
      window.setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 40);
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    window.addEventListener('blur', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
      window.removeEventListener('blur', handleWindowMouseUp);
    };
  }, [interactionMode, resolveCandleIndexFromClientX]);

  if (!visibleCandles.length) {
    return (
      <div className="flex-1 bg-[#07090E] border-b border-[#1B2230] flex flex-col items-center justify-center p-6 text-center">
        <AlertCircle className="w-6 h-6 text-[#8B95A5] mb-2" />
        <div className="text-xs font-semibold text-[#E6EDF3]">
          Keine OHLCV-Kerzendaten für {symbol} ({timeframe}) geladen
        </div>
        <div className="text-[11px] text-[#8B95A5] mt-1">
          Wähle links ein Symbol aus dem Multi-Source-Screener oder starte den Backtest.
        </div>
      </div>
    );
  }

  // SVG coordinate constants aliases for render readability
  const W = SVG_W;
  const H = SVG_H;
  const plotW = PLOT_W;
  const plotH = PLOT_H;
  const rightAxisX = RIGHT_AXIS_X;
  const footprintMaxW = FOOTPRINT_MAX_W;
  const xAxisY = X_AXIS_Y;

  const isZoomedOrPanned =
    effectiveWindow !== defaultWindowBars ||
    effectiveRightOffset !== 0 ||
    Math.abs(yZoomScale - 1) > 0.01;

  const barStep = plotW / Math.max(1, visibleCandles.length);
  const adaptiveBarW = Math.max(1.5, Math.min(28, barStep * 0.72));

  const formatXAxisLabel = (tsMs: number, prevTsMs: number | null): string => {
    const d = new Date(tsMs);
    if (timeframe === '1d') {
      return d.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
      });
    }
    const prevD = prevTsMs !== null ? new Date(prevTsMs) : null;
    const dayChanged =
      !prevD ||
      prevD.getDate() !== d.getDate() ||
      prevD.getMonth() !== d.getMonth() ||
      prevD.getFullYear() !== d.getFullYear();

    if (timeframe === '4h' || dayChanged) {
      const dayPart = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
      const timePart = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      return `${dayPart} ${timePart}`;
    }
    return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  };

  const xAxisTicks = useMemo(() => {
    const n =
      viewMode === 'PRICE'
        ? visibleCandles.length
        : equityCurve.length > 0
          ? equityCurve.length
          : visibleCandles.length;
    if (n === 0) return [] as Array<{ idx: number; time: number; label: string }>;
    const desiredTicks = Math.min(7, n);
    const indices: number[] = [];
    if (desiredTicks === 1) {
      indices.push(0);
    } else {
      for (let i = 0; i < desiredTicks; i++) {
        const idx = Math.round((i / (desiredTicks - 1)) * (n - 1));
        if (!indices.includes(idx)) indices.push(idx);
      }
    }
    const out: Array<{ idx: number; time: number; label: string }> = [];
    let prevTime: number | null = null;
    for (const idx of indices) {
      const ts =
        viewMode === 'PRICE'
          ? visibleCandles[idx]?.time
          : equityCurve[idx]?.time ?? visibleCandles[idx]?.time;
      if (!ts) continue;
      out.push({
        idx,
        time: ts,
        label: formatXAxisLabel(ts, prevTime),
      });
      prevTime = ts;
    }
    return out;
  }, [viewMode, visibleCandles, equityCurve, timeframe]);

  const activeIdx =
    inspectState !== null
      ? inspectState.index
      : hoverIndex !== null
        ? hoverIndex
        : visibleCandles.length - 1;
  const activeCandle = visibleCandles[activeIdx] || visibleCandles[visibleCandles.length - 1];
  const inspectedCandle =
    inspectState !== null && visibleCandles[inspectState.index]
      ? visibleCandles[inspectState.index]
      : null;
  const inspectedPrevClose =
    inspectState !== null && inspectedCandle
      ? inspectState.index > 0
        ? visibleCandles[inspectState.index - 1].close
        : inspectedCandle.open
      : 0;

  const xForIdx = (idx: number, total: number) =>
    PAD_LEFT + (total <= 1 ? plotW / 2 : (idx / (total - 1)) * plotW);

  const findGlobalCandleIdxByTime = (timeMs: number) => {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < candles.length; i++) {
      const dist = Math.abs(candles[i].time - timeMs);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    return bestIdx;
  };

  const yForPrice = (p: number) => {
    const ratio = (p - priceBounds.min) / Math.max(priceBounds.max - priceBounds.min, 1e-9);
    return PAD_TOP + plotH - ratio * plotH;
  };

  const yForEquity = (eq: number) => {
    const ratio = (eq - equityBounds.min) / Math.max(equityBounds.max - equityBounds.min, 1e-9);
    return PAD_TOP + plotH - ratio * plotH;
  };

  const yForDd = (ddPct: number) => {
    const ratio = ddPct / Math.max(ddBounds.maxDd, 0.1);
    return PAD_TOP + ratio * plotH;
  };

  const buildPolyline = (values: number[], yFn: (v: number) => number) => {
    return values
      .map((v, i) => `${xForIdx(i, values.length).toFixed(1)},${yFn(v).toFixed(1)}`)
      .join(' ');
  };

  const priceGridTicks = [0, 0.25, 0.5, 0.75, 1].map(
    (t) => priceBounds.min + t * (priceBounds.max - priceBounds.min)
  );

  const equityGridTicks = [0, 0.25, 0.5, 0.75, 1].map(
    (t) => equityBounds.min + t * (equityBounds.max - equityBounds.min)
  );

  return (
    <div className="flex flex-col bg-[#07090E] border-b border-[#1B2230] select-none">
      {/* Chart Toolbar */}
      <div className="flex items-center justify-between px-2.5 py-1 bg-[#0C1017] border-b border-[#1B2230] gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setViewMode('PRICE')}
            className={`px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase border transition-colors whitespace-nowrap shrink-0 ${
              viewMode === 'PRICE'
                ? 'bg-[#00E5FF]/15 text-[#00E5FF] border-[#00E5FF]/50'
                : 'bg-[#07090E] text-[#8B95A5] border-[#1B2230] hover:text-[#E6EDF3]'
            }`}
          >
            {broadcastMode ? `LIVE MARKT-CHART · ${symbol}` : `PREIS & SIGNALE (${visibleTrades.length})`}
          </button>
          {!broadcastMode && (
            <>
              <button
                type="button"
                onClick={() => setViewMode('EQUITY')}
                className={`px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase border transition-colors ${
                  viewMode === 'EQUITY'
                    ? 'bg-[#089981]/15 text-[#089981] border-[#089981]/50'
                    : 'bg-[#07090E] text-[#8B95A5] border-[#1B2230] hover:text-[#E6EDF3]'
                }`}
              >
                EQUITY-KURVE (${initialCapital.toFixed(0)} BASIS)
              </button>
              <button
                type="button"
                onClick={() => setViewMode('DRAWDOWN')}
                className={`px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase border transition-colors ${
                  viewMode === 'DRAWDOWN'
                    ? 'bg-[#F23645]/15 text-[#F23645] border-[#F23645]/50'
                    : 'bg-[#07090E] text-[#8B95A5] border-[#1B2230] hover:text-[#E6EDF3]'
                }`}
              >
                DRAWDOWN %
              </button>
            </>
          )}
        </div>

        {/* OHLCV Live Crosshair Readout */}
        {activeCandle && (
          <div className="flex items-center gap-2.5 text-[10px] font-mono tabular-nums">
            <span className="text-[#8B95A5]">
              {new Date(activeCandle.time).toLocaleTimeString('de-DE', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            <span>
              <span className="text-[#566173]">O </span>
              <span className="text-[#E6EDF3]">{formatPrice(activeCandle.open)}</span>
            </span>
            <span>
              <span className="text-[#566173]">H </span>
              <span className="text-[#089981]">{formatPrice(activeCandle.high)}</span>
            </span>
            <span>
              <span className="text-[#566173]">L </span>
              <span className="text-[#F23645]">{formatPrice(activeCandle.low)}</span>
            </span>
            <span>
              <span className="text-[#566173]">C </span>
              <span
                className={
                  activeCandle.close >= activeCandle.open ? 'text-[#089981]' : 'text-[#F23645]'
                }
              >
                {formatPrice(activeCandle.close)}
              </span>
            </span>
            {activeCandle.vwap && (
              <span>
                <span className="text-[#A855F7]">VWAP </span>
                <span className="text-[#E6EDF3]">{formatPrice(activeCandle.vwap)}</span>
              </span>
            )}
          </div>
        )}

        {/* Overlay Toggles */}
        <div className="flex items-center gap-1">
          {viewMode === 'PRICE' && (
            <>
              <button
                type="button"
                onClick={() => setShowEma((v) => !v)}
                className={`px-1.5 py-0.5 text-[9px] font-mono border ${
                  showEma
                    ? 'border-[#00E5FF]/40 text-[#00E5FF] bg-[#00E5FF]/10'
                    : 'border-[#1B2230] text-[#566173]'
                }`}
              >
                EMA {fastEmaPeriod}/{slowEmaPeriod}
              </button>
              <button
                type="button"
                onClick={() => setShowVwap((v) => !v)}
                className={`px-1.5 py-0.5 text-[9px] font-mono border ${
                  showVwap
                    ? 'border-[#A855F7]/40 text-[#A855F7] bg-[#A855F7]/10'
                    : 'border-[#1B2230] text-[#566173]'
                }`}
              >
                VWAP
              </button>
              <button
                type="button"
                onClick={handleResetChartZoom}
                disabled={!isZoomedOrPanned}
                title="Zoom & Pan auf Standardansicht (140 Bars · Auto-Y) zurücksetzen"
                className={`px-1.5 py-0.5 text-[9px] font-mono tabular-nums border flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors ${
                  isZoomedOrPanned
                    ? 'border-[#00E5FF]/60 text-[#00E5FF] bg-[#00E5FF]/15 hover:bg-[#00E5FF]/25 cursor-pointer'
                    : 'border-[#1B2230] text-[#566173] bg-[#07090E] cursor-default'
                }`}
              >
                <RotateCcw className="w-2.5 h-2.5" />
                RESET
                {isZoomedOrPanned && (
                  <span className="text-[#E6EDF3]">
                    ({visibleCandles.length}B
                    {Math.abs(yZoomScale - 1) > 0.01 ? `·Y${yZoomScale.toFixed(1)}×` : ''})
                  </span>
                )}
              </button>
              {!broadcastMode && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowTradeMarkers((v) => !v)}
                    className={`px-1.5 py-0.5 text-[9px] font-mono border flex items-center gap-1 whitespace-nowrap shrink-0 ${
                      showTradeMarkers
                        ? 'border-[#089981]/40 text-[#089981] bg-[#089981]/10'
                        : 'border-[#1B2230] text-[#566173]'
                    }`}
                  >
                    {showTradeMarkers ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
                    TRADES
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPaperPositionLines((v) => !v)}
                    title="Horizontale Entry-, Stop-Loss- und Take-Profit-Linien für offene Paper-Positionen ein-/ausblenden"
                    className={`px-1.5 py-0.5 text-[9px] font-mono border flex items-center gap-1 whitespace-nowrap shrink-0 ${
                      showPaperPositionLines
                        ? 'border-[#00E5FF]/50 text-[#00E5FF] bg-[#00E5FF]/15'
                        : 'border-[#1B2230] text-[#566173]'
                    }`}
                  >
                    PAPER-POS ({openPaperPositions.length})
                  </button>
                </>
              )}
            </>
          )}
          {viewMode === 'EQUITY' && (
            <button
              type="button"
              onClick={() => setShowShadowEquity((v) => !v)}
              className={`px-1.5 py-0.5 text-[9px] font-mono border ${
                showShadowEquity
                  ? 'border-[#A855F7]/50 text-[#A855F7] bg-[#A855F7]/15'
                  : 'border-[#1B2230] text-[#566173]'
              }`}
            >
              SHADOW ENGINE (GEGENSTRATEGIE)
            </button>
          )}
          {selectedTrade && (
            <button
              type="button"
              onClick={() => onSelectTrade(null)}
              className="px-1.5 py-0.5 text-[9px] font-mono border border-[#F59E0B]/50 text-[#F59E0B] bg-[#F59E0B]/10 whitespace-nowrap shrink-0"
            >
              FOKUS LÖSEN (#{selectedTrade.tradeNumber})
            </button>
          )}
        </div>
      </div>

      {/* Second Compact Toggle Strip: Volume Footprint, POC, Swing H/L, FVG, Orderblocks & Orderbook Heatmap */}
      {viewMode === 'PRICE' && (
        <div className="flex items-center justify-between px-2.5 py-1 bg-[#090D14] border-b border-[#1B2230] gap-2 flex-wrap">
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[9px] font-semibold tracking-wider text-[#566173] uppercase mr-1 whitespace-nowrap">
              Orderflow & SMC
            </span>
            <button
              type="button"
              onClick={() => setShowVolumeBars((v) => !v)}
              title="Vertikale Volumen-Bars auf der X-Achse (unten im Chart) ein-/ausblenden"
              className={`px-2 py-0.5 text-[9px] font-mono border transition-colors whitespace-nowrap shrink-0 ${
                showVolumeBars
                  ? 'border-[#00E5FF]/55 text-[#00E5FF] bg-[#00E5FF]/15'
                  : 'border-[#1B2230] text-[#566173] hover:text-[#8B95A5]'
              }`}
            >
              VOLUMEN
            </button>
            <button
              type="button"
              onClick={() => setShowFootprint((v) => !v)}
              title="Horizontales Volume-Profile-Histogramm mit Buy/Sell-Split direkt neben der Preisskala"
              className={`px-2 py-0.5 text-[9px] font-mono border transition-colors whitespace-nowrap shrink-0 ${
                showFootprint
                  ? 'border-[#089981]/60 text-[#10B981] bg-[#089981]/15'
                  : 'border-[#1B2230] text-[#566173] hover:text-[#8B95A5]'
              }`}
            >
              FOOTPRINT
            </button>
            <button
              type="button"
              onClick={() => setShowPoc((v) => !v)}
              title="Point of Control (POC) und Low Volume Nodes (LVN) ein-/ausblenden"
              className={`px-2 py-0.5 text-[9px] font-mono border transition-colors whitespace-nowrap shrink-0 ${
                showPoc
                  ? 'border-[#F59E0B]/60 text-[#F59E0B] bg-[#F59E0B]/15'
                  : 'border-[#1B2230] text-[#566173] hover:text-[#8B95A5]'
              }`}
            >
              POC / LVN
            </button>
            <button
              type="button"
              onClick={() => setShowSwings((v) => !v)}
              title="Neueste bestätigte Swing Highs & Swing Lows ein-/ausblenden"
              className={`px-2 py-0.5 text-[9px] font-mono border transition-colors whitespace-nowrap shrink-0 ${
                showSwings
                  ? 'border-[#00E5FF]/50 text-[#00E5FF] bg-[#00E5FF]/10'
                  : 'border-[#1B2230] text-[#566173] hover:text-[#8B95A5]'
              }`}
            >
              SWING H/L
            </button>
            <button
              type="button"
              onClick={() => setShowFvg((v) => !v)}
              title="Aktive, unmitigierte Fair Value Gaps (FVG) ein-/ausblenden"
              className={`px-2 py-0.5 text-[9px] font-mono border transition-colors whitespace-nowrap shrink-0 ${
                showFvg
                  ? 'border-[#38BDF8]/50 text-[#38BDF8] bg-[#38BDF8]/10'
                  : 'border-[#1B2230] text-[#566173] hover:text-[#8B95A5]'
              }`}
            >
              FVG ({activeFvgs.length})
            </button>
            <button
              type="button"
              onClick={() => setShowOrderblocks((v) => !v)}
              title="Aktive, unmitigierte Bullish & Bearish Orderblocks ein-/ausblenden"
              className={`px-2 py-0.5 text-[9px] font-mono border transition-colors whitespace-nowrap shrink-0 ${
                showOrderblocks
                  ? 'border-[#10B981]/50 text-[#10B981] bg-[#10B981]/10'
                  : 'border-[#1B2230] text-[#566173] hover:text-[#8B95A5]'
              }`}
            >
              ORDERBLOCKS ({activeOrderBlocks.length})
            </button>
            <button
              type="button"
              disabled={!hasLiveOrderbook}
              onClick={() => {
                if (hasLiveOrderbook) setShowOrderbookHeatmap((v) => !v);
              }}
              title={
                hasLiveOrderbook
                  ? 'Live L2-Orderbuch-Heatmap auf dem Preis-Chart ein-/ausblenden'
                  : 'Für dieses Symbol sind aktuell keine Live-L2-Orderbuchdaten verfügbar'
              }
              className={`px-2 py-0.5 text-[9px] font-mono border transition-colors whitespace-nowrap shrink-0 ${
                !hasLiveOrderbook
                  ? 'border-[#1B2230] text-[#3B4454] bg-[#07090E] cursor-not-allowed'
                  : showOrderbookHeatmap
                    ? 'border-[#A855F7]/60 text-[#C084FC] bg-[#A855F7]/15'
                    : 'border-[#1B2230] text-[#566173] hover:text-[#8B95A5]'
              }`}
            >
              {hasLiveOrderbook ? 'OB HEATMAP' : 'OB HEATMAP (N/V)'}
            </button>
          </div>

          {/* Unboxed tabular summary metadata */}
          <div className="flex items-center gap-2 text-[9px] font-mono tabular-nums text-[#8B95A5] whitespace-nowrap">
            {hoveredBinIndex !== null && footprintData.bins[hoveredBinIndex] ? (
              <>
                <span className="text-[#E6EDF3]">
                  Bin {formatPrice(footprintData.bins[hoveredBinIndex].priceLow)}–
                  {formatPrice(footprintData.bins[hoveredBinIndex].priceHigh)}
                </span>
                <span aria-hidden="true">·</span>
                <span className="text-[#089981]">
                  Buy {footprintData.bins[hoveredBinIndex].buyPct.toFixed(0)}%
                </span>
                <span aria-hidden="true">·</span>
                <span className="text-[#F23645]">
                  Sell {(100 - footprintData.bins[hoveredBinIndex].buyPct).toFixed(0)}%
                </span>
                <span aria-hidden="true">·</span>
                <span className="text-[#F59E0B]">
                  Vol {formatCompactVolume(footprintData.bins[hoveredBinIndex].totalVolume)}
                </span>
              </>
            ) : (
              <>
                {footprintData.pocBin && (
                  <span className="text-[#F59E0B]">
                    POC {formatPrice(footprintData.pocBin.midPrice)} (
                    {formatCompactVolume(footprintData.pocBin.totalVolume)})
                  </span>
                )}
                {footprintData.pocBin && <span aria-hidden="true">·</span>}
                <span>
                  {swingPoints.filter((s) => s.type === 'HIGH').length} SH /{' '}
                  {swingPoints.filter((s) => s.type === 'LOW').length} SL
                </span>
                {hasLiveOrderbook && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-[#C084FC]">
                      L2 {liveOrderbook?.bids.length ?? 0}B/{liveOrderbook?.asks.length ?? 0}A
                    </span>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* SVG Canvas: Wheel = Zoom, Left-Drag = Pan, Shift+Left-Click = Bar Inspector, Right-Axis Drag/Wheel = Y-Zoom */}
      <div
        ref={chartWrapRef}
        onMouseMove={(e) => {
          if (e.shiftKey !== isShiftHover) {
            setIsShiftHover(e.shiftKey);
          }
        }}
        onMouseDown={(e) => {
          if (e.button !== 0 || viewMode !== 'PRICE' || !visibleCandles.length) return;
          const wrap = chartWrapRef.current;
          if (!wrap) return;
          e.preventDefault();
          const { svgX } = resolveSvgCoordsFromClient(e.clientX, e.clientY);

          if (e.shiftKey) {
            const rect = wrap.getBoundingClientRect();
            const idx = resolveCandleIndexFromClientX(e.clientX, e.clientY);
            setInspectState({
              index: idx,
              relX: Math.max(0, Math.min(rect.width, e.clientX - rect.left)),
              relY: Math.max(0, Math.min(rect.height, e.clientY - rect.top)),
              wrapW: rect.width,
              wrapH: rect.height,
            });
            setInteractionMode('INSPECT');
            return;
          }

          if (svgX >= rightAxisX) {
            yZoomStartRef.current = {
              clientY: e.clientY,
              startScale: yZoomScale,
            };
            setInteractionMode('Y_ZOOM');
            return;
          }

          panStartRef.current = {
            clientX: e.clientX,
            startRightOffset: effectiveRightOffset,
            windowCount: effectiveWindow,
            totalCount: totalBars,
          };
          setInteractionMode('PAN');
        }}
        onDoubleClick={(e) => {
          if (viewMode !== 'PRICE') return;
          const { svgX } = resolveSvgCoordsFromClient(e.clientX, e.clientY);
          if (svgX >= rightAxisX) {
            setYZoomScale(1);
          }
        }}
        className={`relative w-full h-[295px] bg-[#07090E] ${
          viewMode !== 'PRICE'
            ? ''
            : interactionMode === 'Y_ZOOM'
              ? 'cursor-ns-resize'
              : interactionMode === 'PAN'
                ? 'cursor-grabbing'
                : interactionMode === 'INSPECT' || isShiftHover
                  ? 'cursor-crosshair'
                  : 'cursor-grab'
        }`}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-full overflow-hidden"
          onMouseLeave={() => {
            setHoverIndex(null);
            setHoveredBinIndex(null);
            setIsShiftHover(false);
          }}
        >
          <defs>
            <clipPath id="terminal-chart-plot-clip">
              <rect x={PAD_LEFT} y={PAD_TOP} width={plotW} height={plotH} />
            </clipPath>
          </defs>

          {/* X-AXIS TIME SCALE (MINUTES / HOURS / DAYS) */}
          <g>
            <line
              x1={PAD_LEFT}
              y1={xAxisY}
              x2={rightAxisX}
              y2={xAxisY}
              stroke="#1B2230"
              strokeWidth="1"
            />
            {xAxisTicks.map((tick, tIdx) => {
              const totalN =
                viewMode === 'PRICE'
                  ? visibleCandles.length
                  : equityCurve.length > 0
                    ? equityCurve.length
                    : visibleCandles.length;
              const tx = xForIdx(tick.idx, totalN);
              const anchor =
                tIdx === 0
                  ? 'start'
                  : tIdx === xAxisTicks.length - 1
                    ? 'end'
                    : 'middle';
              return (
                <g key={`x-tick-${tick.idx}-${tick.time}`}>
                  <line
                    x1={tx}
                    y1={PAD_TOP}
                    x2={tx}
                    y2={xAxisY}
                    stroke="#111620"
                    strokeDasharray="2 3"
                  />
                  <line
                    x1={tx}
                    y1={xAxisY}
                    x2={tx}
                    y2={xAxisY + 4}
                    stroke="#334155"
                    strokeWidth="1"
                  />
                  <text
                    x={tx}
                    y={xAxisY + 15}
                    textAnchor={anchor}
                    fill="#8B95A5"
                    fontSize="9"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {tick.label}
                  </text>
                </g>
              );
            })}
          </g>

          {/* PRICE & SIGNALS VIEW */}
          {viewMode === 'PRICE' && (
            <>
              {/* Horizontal Grid Lines & Right Price Scale Axis */}
              <line
                x1={rightAxisX}
                y1={PAD_TOP}
                x2={rightAxisX}
                y2={PAD_TOP + plotH}
                stroke="#1B2230"
                strokeWidth="1"
              />
              {priceGridTicks.map((tick, idx) => {
                const y = yForPrice(tick);
                return (
                  <g key={idx}>
                    <line
                      x1={PAD_LEFT}
                      y1={y}
                      x2={rightAxisX}
                      y2={y}
                      stroke="#141A24"
                      strokeDasharray="2 2"
                    />
                    <text
                      x={rightAxisX + 6}
                      y={y + 3}
                      fill="#8B95A5"
                      fontSize="9"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {formatPrice(tick)}
                    </text>
                  </g>
                );
              })}

              {/* Interactive Right Price-Scale Drag/Wheel Target + Y-Scale Badge */}
              <rect
                x={rightAxisX}
                y={PAD_TOP}
                width={PAD_RIGHT}
                height={plotH}
                fill="transparent"
                className="cursor-ns-resize"
              />
              {Math.abs(yZoomScale - 1) > 0.01 && (
                <text
                  x={rightAxisX + 6}
                  y={xAxisY - 4}
                  fill="#00E5FF"
                  fontSize="8"
                  fontWeight="bold"
                  fontFamily="JetBrains Mono, monospace"
                >
                  Y {yZoomScale.toFixed(2)}×
                </text>
              )}

              {/* Clipped Plot Layers (Strictly bounded within plotW x plotH during X & Y Zoom) */}
              <g clipPath="url(#terminal-chart-plot-clip)">
                {/* 0. Vertical Volume Bars on X-Axis (Bottom 18% of Main Chart Height) */}
                {showVolumeBars &&
                  maxCandleVolume > 0 &&
                  visibleCandles.map((c, idx) => {
                    const x = xForIdx(idx, visibleCandles.length);
                    const volW = adaptiveBarW;
                    const barH = Math.max(1.5, (c.volume / maxCandleVolume) * (plotH * 0.18));
                    const isBull = c.close >= c.open;
                    const isInspected = inspectState?.index === idx;
                    return (
                      <rect
                        key={`vol-bar-${c.time}`}
                        x={x - volW / 2}
                        y={xAxisY - barH}
                        width={volW}
                        height={barH}
                        fill={isBull ? '#089981' : '#F23645'}
                        fillOpacity={isInspected ? 0.72 : 0.34}
                      />
                    );
                  })}
                {/* 1. Live L2 Orderbook Heatmap (only rendered when real depth is available) */}
                {showOrderbookHeatmap &&
                  heatmapBands.length > 0 &&
                  heatmapBands.map((band, bIdx) => {
                    const y = yForPrice(band.price);
                    const bandH = Math.max(3, Math.min(8, plotH / 32));
                    const isBid = band.side === 'BID';
                    const baseColor = isBid ? '#089981' : '#F23645';
                    const fillOpacity = 0.04 + band.intensity * 0.14;
                    const wallW = 8 + band.intensity * 36;
                    return (
                      <g key={`ob-heat-${band.side}-${bIdx}`}>
                        <rect
                          x={PAD_LEFT}
                          y={y - bandH / 2}
                          width={plotW}
                          height={bandH}
                          fill={baseColor}
                          fillOpacity={fillOpacity}
                        />
                        <rect
                          x={rightAxisX - wallW}
                          y={y - bandH / 2}
                          width={wallW}
                          height={bandH}
                          fill={baseColor}
                          fillOpacity={0.22 + band.intensity * 0.45}
                        />
                      </g>
                    );
                  })}

                {/* 2. Active Unmitigated Fair Value Gaps (FVG) */}
                {showFvg &&
                  activeFvgs.map((fvg) => {
                    const xStart = xForIdx(fvg.startIndex, visibleCandles.length);
                    const yTop = yForPrice(fvg.high);
                    const yBottom = yForPrice(fvg.low);
                    const rectH = Math.max(2, yBottom - yTop);
                    const rectW = Math.max(12, rightAxisX - xStart);
                    const isBull = fvg.direction === 'BULLISH';
                    const strokeColor = isBull ? '#089981' : '#F23645';
                    return (
                      <g key={fvg.id}>
                        <rect
                          x={xStart}
                          y={yTop}
                          width={rectW}
                          height={rectH}
                          fill={strokeColor}
                          fillOpacity={0.09}
                          stroke={strokeColor}
                          strokeOpacity={0.45}
                          strokeWidth="0.8"
                          strokeDasharray="3 2"
                        />
                        {rectH >= 8 && (
                          <text
                            x={xStart + 4}
                            y={yTop + Math.min(10, rectH - 2)}
                            fill={strokeColor}
                            fillOpacity={0.85}
                            fontSize="8"
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {isBull ? 'FVG+' : 'FVG-'}
                          </text>
                        )}
                      </g>
                    );
                  })}

                {/* 3. Active Unmitigated Orderblocks */}
                {showOrderblocks &&
                  activeOrderBlocks.map((ob) => {
                    const xStart = xForIdx(ob.startIndex, visibleCandles.length);
                    const yTop = yForPrice(ob.high);
                    const yBottom = yForPrice(ob.low);
                    const yMid = yForPrice(ob.midPrice);
                    const rectH = Math.max(3, yBottom - yTop);
                    const rectW = Math.max(16, rightAxisX - xStart);
                    const isBull = ob.direction === 'BULLISH';
                    const color = isBull ? '#089981' : '#F23645';
                    return (
                      <g key={ob.id}>
                        <rect
                          x={xStart}
                          y={yTop}
                          width={rectW}
                          height={rectH}
                          fill={color}
                          fillOpacity={0.14}
                          stroke={color}
                          strokeOpacity={0.6}
                          strokeWidth="0.9"
                        />
                        <line
                          x1={xStart}
                          y1={yMid}
                          x2={rightAxisX}
                          y2={yMid}
                          stroke={color}
                          strokeOpacity={0.45}
                          strokeWidth="0.7"
                          strokeDasharray="2 3"
                        />
                        <text
                          x={xStart + 5}
                          y={yTop + Math.min(10, rectH - 2)}
                          fill={color}
                          fontSize="8"
                          fontWeight="600"
                          fontFamily="JetBrains Mono, monospace"
                        >
                          {isBull ? 'BULL OB' : 'BEAR OB'}
                        </text>
                      </g>
                    );
                  })}

                {/* 4. Volume Footprint (Volume Profile with Buy/Sell Split) anchored directly left of Price Scale */}
                {showFootprint &&
                  footprintData.maxBinVolume > 0 &&
                  footprintData.bins.map((bin) => {
                    if (bin.totalVolume <= 0) return null;
                    const yTop = yForPrice(bin.priceHigh);
                    const yBottom = yForPrice(bin.priceLow);
                    const barH = Math.max(2, yBottom - yTop - 1.2);
                    const totalW = (bin.totalVolume / footprintData.maxBinVolume) * footprintMaxW;
                    const buyW = (bin.buyVolume / bin.totalVolume) * totalW;
                    const sellW = Math.max(0, totalW - buyW);
                    const isHovered = hoveredBinIndex === bin.index;
                    const barOpacity = bin.isPoc ? 0.85 : isHovered ? 0.8 : 0.44;
                    const rightAnchor = rightAxisX - 2;

                    return (
                      <g
                        key={`fp-bin-${bin.index}`}
                        onMouseEnter={() => setHoveredBinIndex(bin.index)}
                        onMouseLeave={() => setHoveredBinIndex(null)}
                        className="cursor-crosshair"
                      >
                        {/* Sell volume segment (left portion of horizontal bar) */}
                        {sellW > 0.5 && (
                          <rect
                            x={rightAnchor - totalW}
                            y={yTop + 0.6}
                            width={sellW}
                            height={barH}
                            fill="#F23645"
                            fillOpacity={barOpacity}
                          />
                        )}
                        {/* Buy volume segment (anchored against right price scale) */}
                        {buyW > 0.5 && (
                          <rect
                            x={rightAnchor - buyW}
                            y={yTop + 0.6}
                            width={buyW}
                            height={barH}
                            fill="#089981"
                            fillOpacity={barOpacity}
                          />
                        )}
                        {/* Highlight outline on POC or hovered bin */}
                        {(bin.isPoc || isHovered) && (
                          <rect
                            x={rightAnchor - totalW}
                            y={yTop + 0.6}
                            width={totalW}
                            height={barH}
                            fill="none"
                            stroke={bin.isPoc ? '#F59E0B' : '#00E5FF'}
                            strokeWidth={bin.isPoc ? '1' : '0.8'}
                          />
                        )}
                      </g>
                    );
                  })}

                {/* 5. POC & LVN Horizontal Lines inside plot */}
                {showPoc && footprintData.pocBin && (
                  <line
                    x1={PAD_LEFT}
                    y1={yForPrice(footprintData.pocBin.midPrice)}
                    x2={rightAxisX}
                    y2={yForPrice(footprintData.pocBin.midPrice)}
                    stroke="#F59E0B"
                    strokeWidth="1.3"
                    strokeOpacity="0.9"
                  />
                )}
                {showPoc &&
                  footprintData.lvnBins.map((lvn, lIdx) => (
                    <line
                      key={`lvn-line-${lIdx}`}
                      x1={PAD_LEFT}
                      y1={yForPrice(lvn.midPrice)}
                      x2={rightAxisX}
                      y2={yForPrice(lvn.midPrice)}
                      stroke="#8B95A5"
                      strokeWidth="0.9"
                      strokeOpacity="0.55"
                      strokeDasharray="1.5 2.5"
                    />
                  ))}
                {/* 6. Selected Trade Stop-Loss & Take-Profit Horizontal Lines */}
              {selectedTrade && (
                <g>
                  <line
                    x1={PAD_LEFT}
                    y1={yForPrice(selectedTrade.stopLossPrice)}
                    x2={W - PAD_RIGHT}
                    y2={yForPrice(selectedTrade.stopLossPrice)}
                    stroke="#F23645"
                    strokeWidth="1"
                    strokeDasharray="4 2"
                  />
                  <text
                    x={PAD_LEFT + 6}
                    y={yForPrice(selectedTrade.stopLossPrice) - 3}
                    fill="#F23645"
                    fontSize="9"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    BT SL {formatPrice(selectedTrade.stopLossPrice)}
                  </text>
                  <line
                    x1={PAD_LEFT}
                    y1={yForPrice(selectedTrade.takeProfitPrice)}
                    x2={W - PAD_RIGHT}
                    y2={yForPrice(selectedTrade.takeProfitPrice)}
                    stroke="#089981"
                    strokeWidth="1"
                    strokeDasharray="4 2"
                  />
                  <text
                    x={PAD_LEFT + 6}
                    y={yForPrice(selectedTrade.takeProfitPrice) - 3}
                    fill="#089981"
                    fontSize="9"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    BT TP {formatPrice(selectedTrade.takeProfitPrice)}
                  </text>
                </g>
              )}

              {/* Open Paper Position Entry, Auto-SL & Auto-TP Horizontal Lines */}
              {!broadcastMode &&
                showPaperPositionLines &&
                openPaperPositions.map((pos, pIdx) => {
                  const yEntry = yForPrice(pos.entryPrice);
                  const ySl = yForPrice(pos.stopLossPrice);
                  const yTp = yForPrice(pos.takeProfitPrice);
                  const pnlSign = pos.unrealizedPnl >= 0 ? '+' : '';
                  return (
                    <g key={`paper-pos-${pos.pair}-${pIdx}`}>
                      {/* Paper Entry Line */}
                      <line
                        x1={PAD_LEFT}
                        y1={yEntry}
                        x2={W - PAD_RIGHT}
                        y2={yEntry}
                        stroke="#00E5FF"
                        strokeWidth="1.3"
                        strokeDasharray="6 2"
                      />
                      <text
                        x={PAD_LEFT + 6}
                        y={yEntry - 4}
                        fill="#00E5FF"
                        fontSize="9"
                        fontWeight="bold"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        PAPER {pos.side} ENTRY {formatPrice(pos.entryPrice)} ({pnlSign}$
                        {pos.unrealizedPnl.toFixed(2)})
                      </text>

                      {/* Paper Stop-Loss Line */}
                      <line
                        x1={PAD_LEFT}
                        y1={ySl}
                        x2={W - PAD_RIGHT}
                        y2={ySl}
                        stroke={pos.isBreakEven ? '#00E5FF' : '#F59E0B'}
                        strokeWidth="1.2"
                        strokeDasharray="3 3"
                      />
                      <text
                        x={W - PAD_RIGHT - 155}
                        y={ySl - 4}
                        fill={pos.isBreakEven ? '#00E5FF' : '#F59E0B'}
                        fontSize="9"
                        fontWeight="bold"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {pos.isBreakEven ? 'AUTO-SL (BE)' : 'AUTO-SL'} {formatPrice(pos.stopLossPrice)}
                      </text>

                      {/* Paper Take-Profit Line */}
                      <line
                        x1={PAD_LEFT}
                        y1={yTp}
                        x2={W - PAD_RIGHT}
                        y2={yTp}
                        stroke="#089981"
                        strokeWidth="1.2"
                        strokeDasharray="3 3"
                      />
                      <text
                        x={W - PAD_RIGHT - 155}
                        y={yTp - 4}
                        fill="#089981"
                        fontSize="9"
                        fontWeight="bold"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        AUTO-TP {formatPrice(pos.takeProfitPrice)}
                      </text>
                    </g>
                  );
                })}

              {/* VWAP Line */}
              {showVwap && (
                <polyline
                  fill="none"
                  stroke="#A855F7"
                  strokeWidth="1.2"
                  strokeDasharray="3 2"
                  opacity="0.75"
                  points={buildPolyline(
                    visibleCandles.map((c) => c.vwap || c.close),
                    yForPrice
                  )}
                />
              )}

              {/* Fast & Slow EMA Lines */}
              {showEma && fastEma.length === visibleCandles.length && (
                <>
                  <polyline
                    fill="none"
                    stroke="#00E5FF"
                    strokeWidth="1.3"
                    opacity="0.85"
                    points={buildPolyline(fastEma, yForPrice)}
                  />
                  <polyline
                    fill="none"
                    stroke="#F59E0B"
                    strokeWidth="1.2"
                    opacity="0.75"
                    points={buildPolyline(slowEma, yForPrice)}
                  />
                </>
              )}

              {/* Candlesticks */}
              {visibleCandles.map((c, idx) => {
                const x = xForIdx(idx, visibleCandles.length);
                const isBull = c.close >= c.open;
                const color = isBull ? '#089981' : '#F23645';
                const yHigh = yForPrice(c.high);
                const yLow = yForPrice(c.low);
                const yOpen = yForPrice(c.open);
                const yClose = yForPrice(c.close);
                const bodyTop = Math.min(yOpen, yClose);
                const bodyH = Math.max(1.5, Math.abs(yClose - yOpen));
                const candleW = adaptiveBarW;

                return (
                  <g
                    key={c.time}
                    onMouseEnter={() => setHoverIndex(idx)}
                  >
                    <line x1={x} y1={yHigh} x2={x} y2={yLow} stroke={color} strokeWidth="1" />
                    <rect
                      x={x - candleW / 2}
                      y={bodyTop}
                      width={candleW}
                      height={bodyH}
                      fill={color}
                    />
                  </g>
                );
              })}

              {/* Swing Highs & Swing Lows (Latest Confirmed Fractals) */}
              {showSwings &&
                swingPoints.map((sp) => {
                  const sx = xForIdx(sp.index, visibleCandles.length);
                  const sy = yForPrice(sp.price);
                  const isHigh = sp.type === 'HIGH';
                  const color = isHigh ? '#F23645' : '#089981';
                  const markerY = isHigh ? sy - 6 : sy + 6;
                  const points = isHigh
                    ? `${sx},${sy - 2} ${sx - 3.5},${markerY - 3} ${sx + 3.5},${markerY - 3}`
                    : `${sx},${sy + 2} ${sx - 3.5},${markerY + 3} ${sx + 3.5},${markerY + 3}`;

                  return (
                    <g key={`swing-${sp.type}-${sp.time}`}>
                      {sp.isLatest && (
                        <>
                          <line
                            x1={sx}
                            y1={sy}
                            x2={rightAxisX}
                            y2={sy}
                            stroke={color}
                            strokeWidth="0.9"
                            strokeDasharray="3 3"
                            strokeOpacity={0.75}
                          />
                          <text
                            x={Math.min(sx + 6, rightAxisX - 96)}
                            y={isHigh ? sy - 4 : sy + 10}
                            fill={color}
                            fontSize="8"
                            fontWeight="600"
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {isHigh ? 'SWING H' : 'SWING L'} {formatPrice(sp.price)}
                          </text>
                        </>
                      )}
                      <polygon
                        points={points}
                        fill={color}
                        fillOpacity={sp.isLatest ? 0.95 : 0.6}
                      />
                    </g>
                  );
                })}

              {/* Trade Entry & Exit Connecting Lines + Glowing Markers */}
              {!broadcastMode &&
                showTradeMarkers &&
                visibleTrades.map((t) => {
                  const localEntryIdx = findGlobalCandleIdxByTime(t.entryTime) - startIndex;
                  const localExitIdx = findGlobalCandleIdxByTime(t.exitTime) - startIndex;
                  const x1 = xForIdx(localEntryIdx, visibleCandles.length);
                  const y1 = yForPrice(t.entryPrice);
                  const x2 = xForIdx(localExitIdx, visibleCandles.length);
                  const y2 = yForPrice(t.exitPrice);
                  const isWin = t.netPnlUsd >= 0;
                  const isSelected = t.id === selectedTradeId;

                  return (
                    <g
                      key={t.id}
                      onClick={() => {
                        if (suppressNextClickRef.current) return;
                        onSelectTrade(isSelected ? null : t.id);
                      }}
                      className="cursor-pointer"
                    >
                      <line
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke={isWin ? '#089981' : '#F23645'}
                        strokeWidth={isSelected ? '2' : '1.1'}
                        strokeDasharray="2 2"
                        opacity={isSelected ? '1' : '0.75'}
                      />
                      {/* Entry Dot (Cyan) */}
                      <circle
                        cx={x1}
                        cy={y1}
                        r={isSelected ? 4.5 : 3}
                        fill="#00E5FF"
                        stroke="#07090E"
                        strokeWidth="1"
                      />
                      {/* Exit Dot (Emerald for Win, Crimson for Loss) */}
                      <circle
                        cx={x2}
                        cy={y2}
                        r={isSelected ? 5 : 3.2}
                        fill={isWin ? '#089981' : '#F23645'}
                        stroke="#E6EDF3"
                        strokeWidth="0.8"
                      />
                    </g>
                  );
                })}

              {/* Click-and-Hold Vertical & Horizontal Crosshair Overlay */}
              {inspectState !== null && inspectedCandle && (
                <g className="pointer-events-none">
                  <line
                    x1={xForIdx(inspectState.index, visibleCandles.length)}
                    y1={PAD_TOP}
                    x2={xForIdx(inspectState.index, visibleCandles.length)}
                    y2={xAxisY}
                    stroke="#00E5FF"
                    strokeWidth="1"
                    strokeDasharray="3 2"
                  />
                  <line
                    x1={PAD_LEFT}
                    y1={yForPrice(inspectedCandle.close)}
                    x2={rightAxisX}
                    y2={yForPrice(inspectedCandle.close)}
                    stroke="#00E5FF"
                    strokeWidth="0.8"
                    strokeOpacity="0.45"
                    strokeDasharray="3 2"
                  />
                  <circle
                    cx={xForIdx(inspectState.index, visibleCandles.length)}
                    cy={yForPrice(inspectedCandle.close)}
                    r={3.8}
                    fill="#00E5FF"
                    stroke="#07090E"
                    strokeWidth="1.2"
                  />
                </g>
              )}
              </g>

              {/* POC & LVN Price-Scale Callout Labels (clamped inside vertical price scale bounds) */}
              {showPoc &&
                footprintData.pocBin &&
                (() => {
                  const pocY = yForPrice(footprintData.pocBin.midPrice);
                  if (pocY < PAD_TOP + 6 || pocY > xAxisY - 6) return null;
                  return (
                    <g className="pointer-events-none">
                      <rect
                        x={rightAxisX + 2}
                        y={pocY - 7}
                        width={PAD_RIGHT - 4}
                        height={14}
                        rx={2}
                        fill="#F59E0B"
                      />
                      <text
                        x={rightAxisX + 5}
                        y={pocY + 3}
                        fill="#07090E"
                        fontSize="8"
                        fontWeight="bold"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        POC {formatPrice(footprintData.pocBin.midPrice)}
                      </text>
                    </g>
                  );
                })()}
              {showPoc &&
                footprintData.lvnBins.map((lvn, lIdx) => {
                  const lvnY = yForPrice(lvn.midPrice);
                  if (lvnY < PAD_TOP + 5 || lvnY > xAxisY - 5) return null;
                  return (
                    <text
                      key={`lvn-lbl-${lIdx}`}
                      x={rightAxisX + 6}
                      y={lvnY + 3}
                      fill="#94A3B8"
                      fontSize="8"
                      fontFamily="JetBrains Mono, monospace"
                      className="pointer-events-none"
                    >
                      LVN
                    </text>
                  );
                })}
            </>
          )}

          {/* EQUITY CURVE VIEW (BASIS + SHADOW ENGINE COUNTER-CURVE) */}
          {viewMode === 'EQUITY' && equityCurve.length > 0 && (
            <>
              {equityGridTicks.map((tick, idx) => {
                const y = yForEquity(tick);
                return (
                  <g key={idx}>
                    <line
                      x1={PAD_LEFT}
                      y1={y}
                      x2={W - PAD_RIGHT}
                      y2={y}
                      stroke="#141A24"
                      strokeDasharray="2 2"
                    />
                    <text
                      x={W - PAD_RIGHT + 5}
                      y={y + 3}
                      fill="#8B95A5"
                      fontSize="9"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      ${tick.toFixed(0)}
                    </text>
                  </g>
                );
              })}

              {/* Initial Capital Baseline */}
              <line
                x1={PAD_LEFT}
                y1={yForEquity(initialCapital)}
                x2={W - PAD_RIGHT}
                y2={yForEquity(initialCapital)}
                stroke="#566173"
                strokeWidth="1"
                strokeDasharray="3 3"
              />

              {/* Shadow Inverse Equity Curve */}
              {showShadowEquity && (
                <polyline
                  fill="none"
                  stroke="#A855F7"
                  strokeWidth="1.4"
                  strokeDasharray="3 2"
                  points={buildPolyline(
                    equityCurve.map((pt) => pt.shadowEquity),
                    yForEquity
                  )}
                />
              )}

              {/* Primary Equity Curve */}
              <polyline
                fill="none"
                stroke="#089981"
                strokeWidth="2"
                points={buildPolyline(
                  equityCurve.map((pt) => pt.equity),
                  yForEquity
                )}
              />
            </>
          )}

          {/* DRAWDOWN % VIEW */}
          {viewMode === 'DRAWDOWN' && equityCurve.length > 0 && (
            <>
              {[0, 0.25, 0.5, 0.75, 1].map((t, idx) => {
                const val = t * ddBounds.maxDd;
                const y = yForDd(val);
                return (
                  <g key={idx}>
                    <line
                      x1={PAD_LEFT}
                      y1={y}
                      x2={W - PAD_RIGHT}
                      y2={y}
                      stroke="#141A24"
                      strokeDasharray="2 2"
                    />
                    <text
                      x={W - PAD_RIGHT + 5}
                      y={y + 3}
                      fill="#F23645"
                      fontSize="9"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      -{val.toFixed(1)}%
                    </text>
                  </g>
                );
              })}
              <polyline
                fill="none"
                stroke="#F23645"
                strokeWidth="1.8"
                points={buildPolyline(
                  equityCurve.map((pt) => pt.drawdownPct),
                  yForDd
                )}
              />
            </>
          )}
        </svg>

        {/* Left-Click & Hold Floating OHLC + Time + Close vs Prev-Close Tooltip */}
        {viewMode === 'PRICE' &&
          inspectState !== null &&
          inspectedCandle &&
          (() => {
            const deltaUsd = inspectedCandle.close - inspectedPrevClose;
            const deltaPct =
              inspectedPrevClose > 0 ? (deltaUsd / inspectedPrevClose) * 100 : 0;
            const isUp = deltaUsd >= 0;
            const flipLeft = inspectState.relX > inspectState.wrapW - 235;
            const leftPos = flipLeft
              ? Math.max(8, inspectState.relX - 224)
              : Math.min(inspectState.wrapW - 224, inspectState.relX + 14);
            const topPos = Math.max(8, Math.min(inspectState.wrapH - 148, inspectState.relY - 40));

            return (
              <div
                style={{ left: `${leftPos}px`, top: `${topPos}px` }}
                className="absolute z-20 w-[212px] bg-[#0C1017]/95 border border-[#00E5FF]/55 px-2.5 py-2 shadow-lg pointer-events-none font-mono tabular-nums text-[10px]"
              >
                <div className="flex items-center justify-between border-b border-[#1B2230] pb-1 mb-1">
                  <span className="text-[#00E5FF] font-bold">
                    BAR #{inspectState.index + 1} · {timeframe}
                  </span>
                  <span className="text-[#E6EDF3]">
                    {new Date(inspectedCandle.time).toLocaleString('de-DE', {
                      day: '2-digit',
                      month: '2-digit',
                      year: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
                  <div className="flex justify-between">
                    <span className="text-[#8B95A5]">Open</span>
                    <span className="text-[#E6EDF3]">{formatPrice(inspectedCandle.open)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8B95A5]">High</span>
                    <span className="text-[#089981]">{formatPrice(inspectedCandle.high)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8B95A5]">Low</span>
                    <span className="text-[#F23645]">{formatPrice(inspectedCandle.low)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8B95A5]">Close</span>
                    <span className="text-[#E6EDF3] font-bold">
                      {formatPrice(inspectedCandle.close)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-1 pt-1 border-t border-[#1B2230]">
                  <span className="text-[#8B95A5]">vs. Prev Close</span>
                  <span className={`font-bold ${isUp ? 'text-[#089981]' : 'text-[#F23645]'}`}>
                    {isUp ? '+' : '-'}
                    {formatPrice(Math.abs(deltaUsd))} ({isUp ? '+' : ''}
                    {deltaPct.toFixed(2)}%)
                  </span>
                </div>
                <div className="flex items-center justify-between text-[9px] text-[#8B95A5] mt-0.5">
                  <span>Volumen</span>
                  <span className="text-[#E6EDF3]">
                    {formatCompactVolume(inspectedCandle.volume)}
                  </span>
                </div>
              </div>
            );
          })()}
      </div>

      {/* Dedicated Bottom Legend & Source Strip below SVG (Zero Overlap with X-Axis Time Labels) */}
      <div className="px-2.5 py-1 bg-[#090D14] border-t border-[#1B2230] flex items-center justify-between text-[9px] font-mono tabular-nums text-[#8B95A5]">
        <div className="flex items-center gap-3 flex-wrap">
          {!broadcastMode && (
            <>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#00E5FF] inline-block" />
                ENTER
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#089981] inline-block" />
                EXIT WIN / TP
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#F23645] inline-block" />
                EXIT LOSS / SL
              </span>
            </>
          )}
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-0.5 bg-[#A855F7] inline-block" />
            {viewMode === 'EQUITY' ? 'SHADOW ENGINE (INVERS)' : 'VWAP'}
          </span>
          {viewMode === 'PRICE' && (
            <span className="text-[#566173]">
              Mausrad: Zoom · Drag: Verschieben · Shift+Klick: Bar-Details · Y-Achse: Preis-Zoom
            </span>
          )}
        </div>
        <div className="whitespace-nowrap">
          QUELLE: <span className="text-[#00E5FF] font-semibold">{provider}</span> ·{' '}
          {visibleCandles.length}/{candles.length} BARS ({timeframe})
        </div>
      </div>
    </div>
  );
});
