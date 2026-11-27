import { OHLCVCandle } from '../types/terminal';
import { OrderbookData, OrderbookEntry } from '../types/trading';

export interface VolumeFootprintBin {
  index: number;
  priceLow: number;
  priceHigh: number;
  midPrice: number;
  buyVolume: number;
  sellVolume: number;
  totalVolume: number;
  delta: number;
  buyPct: number;
  isPoc: boolean;
  isLvn: boolean;
}

export interface VolumeFootprintResult {
  bins: VolumeFootprintBin[];
  pocBin: VolumeFootprintBin | null;
  lvnBins: VolumeFootprintBin[];
  maxBinVolume: number;
  totalVolume: number;
}

export interface SwingPoint {
  index: number;
  time: number;
  price: number;
  type: 'HIGH' | 'LOW';
  isLatest: boolean;
}

export interface FairValueGapZone {
  id: string;
  startIndex: number;
  startTime: number;
  high: number;
  low: number;
  direction: 'BULLISH' | 'BEARISH';
  partiallyMitigated: boolean;
}

export interface OrderBlockZone {
  id: string;
  startIndex: number;
  startTime: number;
  high: number;
  low: number;
  midPrice: number;
  direction: 'BULLISH' | 'BEARISH';
}

export interface OrderbookHeatmapBand {
  price: number;
  size: number;
  total: number;
  side: 'BID' | 'ASK';
  intensity: number; // 0.12 .. 1.0
}

/**
 * Computes horizontal Volume Footprint (Volume Profile with Buy/Sell split),
 * Point of Control (POC), and Low Volume Nodes (LVN) across visible candles.
 */
export function computeVolumeFootprint(
  candles: OHLCVCandle[],
  priceMin: number,
  priceMax: number,
  numBins: number = 30
): VolumeFootprintResult {
  if (!candles.length || priceMax <= priceMin || numBins < 4) {
    return { bins: [], pocBin: null, lvnBins: [], maxBinVolume: 0, totalVolume: 0 };
  }

  const span = priceMax - priceMin;
  const step = span / numBins;

  const acc = Array.from({ length: numBins }, (_, i) => ({
    index: i,
    priceLow: priceMin + i * step,
    priceHigh: priceMin + (i + 1) * step,
    midPrice: priceMin + (i + 0.5) * step,
    buyVolume: 0,
    sellVolume: 0,
  }));

  for (const c of candles) {
    const vol = Math.max(0, Number(c.volume) || 0);
    if (vol <= 0) continue;

    const cLow = Math.min(c.low, c.high);
    const cHigh = Math.max(c.low, c.high);
    const cRange = cHigh - cLow;

    // Estimate intra-bar buy vs sell dominance from candle close placement
    let buyRatio = c.close >= c.open ? 0.58 : 0.42;
    if (cRange > 1e-12) {
      const closePos = (c.close - cLow) / cRange;
      buyRatio = Math.max(0.12, Math.min(0.88, closePos));
    }

    const startBin = Math.max(0, Math.min(numBins - 1, Math.floor((cLow - priceMin) / step)));
    const endBin = Math.max(0, Math.min(numBins - 1, Math.floor((cHigh - priceMin) / step)));

    if (startBin === endBin || cRange <= 1e-12) {
      acc[startBin].buyVolume += vol * buyRatio;
      acc[startBin].sellVolume += vol * (1 - buyRatio);
    } else {
      let totalOverlap = 0;
      const overlaps: number[] = [];
      for (let b = startBin; b <= endBin; b++) {
        const bLow = acc[b].priceLow;
        const bHigh = acc[b].priceHigh;
        const overlap = Math.max(0, Math.min(cHigh, bHigh) - Math.max(cLow, bLow));
        overlaps.push(overlap);
        totalOverlap += overlap;
      }

      if (totalOverlap > 0) {
        for (let k = 0; k < overlaps.length; k++) {
          const b = startBin + k;
          const weight = overlaps[k] / totalOverlap;
          acc[b].buyVolume += vol * weight * buyRatio;
          acc[b].sellVolume += vol * weight * (1 - buyRatio);
        }
      } else {
        const count = endBin - startBin + 1;
        for (let b = startBin; b <= endBin; b++) {
          acc[b].buyVolume += (vol / count) * buyRatio;
          acc[b].sellVolume += (vol / count) * (1 - buyRatio);
        }
      }
    }
  }

  let maxBinVolume = 0;
  let pocIndex = -1;
  let totalVolume = 0;

  const bins: VolumeFootprintBin[] = acc.map((b, i) => {
    const total = b.buyVolume + b.sellVolume;
    totalVolume += total;
    if (total > maxBinVolume) {
      maxBinVolume = total;
      pocIndex = i;
    }
    return {
      index: b.index,
      priceLow: b.priceLow,
      priceHigh: b.priceHigh,
      midPrice: b.midPrice,
      buyVolume: b.buyVolume,
      sellVolume: b.sellVolume,
      totalVolume: total,
      delta: b.buyVolume - b.sellVolume,
      buyPct: total > 0 ? (b.buyVolume / total) * 100 : 50,
      isPoc: false,
      isLvn: false,
    };
  });

  if (pocIndex >= 0 && bins[pocIndex]) {
    bins[pocIndex].isPoc = true;
  }

  // Detect up to 2 significant Low Volume Nodes (valleys flanked by higher-volume nodes)
  const lvnCandidates: VolumeFootprintBin[] = [];
  if (maxBinVolume > 0) {
    for (let i = 2; i < bins.length - 2; i++) {
      const curr = bins[i];
      if (curr.isPoc || curr.totalVolume <= 0) continue;
      const prev = bins[i - 1];
      const next = bins[i + 1];
      if (
        curr.totalVolume < prev.totalVolume * 0.85 &&
        curr.totalVolume < next.totalVolume * 0.85 &&
        curr.totalVolume < maxBinVolume * 0.42
      ) {
        lvnCandidates.push(curr);
      }
    }
  }

  lvnCandidates.sort((a, b) => a.totalVolume - b.totalVolume);
  const selectedLvns = lvnCandidates.slice(0, 2);
  for (const lvn of selectedLvns) {
    bins[lvn.index].isLvn = true;
  }

  return {
    bins,
    pocBin: pocIndex >= 0 ? bins[pocIndex] : null,
    lvnBins: selectedLvns,
    maxBinVolume,
    totalVolume,
  };
}

/**
 * Detects the latest confirmed fractal Swing Highs & Swing Lows.
 */
export function detectLatestSwingPoints(
  candles: OHLCVCandle[],
  pivotWindow: number = 3
): SwingPoint[] {
  if (candles.length < pivotWindow * 2 + 1) return [];

  const highs: SwingPoint[] = [];
  const lows: SwingPoint[] = [];

  for (let i = pivotWindow; i < candles.length - pivotWindow; i++) {
    const curr = candles[i];
    let isSwingHigh = true;
    let isSwingLow = true;
    let strictlyHigherCount = 0;
    let strictlyLowerCount = 0;

    for (let j = i - pivotWindow; j <= i + pivotWindow; j++) {
      if (j === i) continue;
      if (candles[j].high > curr.high) {
        isSwingHigh = false;
      } else if (candles[j].high < curr.high) {
        strictlyHigherCount++;
      }

      if (candles[j].low < curr.low) {
        isSwingLow = false;
      } else if (candles[j].low > curr.low) {
        strictlyLowerCount++;
      }
    }

    if (isSwingHigh && strictlyHigherCount >= 2) {
      highs.push({
        index: i,
        time: curr.time,
        price: curr.high,
        type: 'HIGH',
        isLatest: false,
      });
    }
    if (isSwingLow && strictlyLowerCount >= 2) {
      lows.push({
        index: i,
        time: curr.time,
        price: curr.low,
        type: 'LOW',
        isLatest: false,
      });
    }
  }

  const latestHighs = highs.slice(-2);
  const latestLows = lows.slice(-2);

  if (latestHighs.length > 0) {
    latestHighs[latestHighs.length - 1].isLatest = true;
  }
  if (latestLows.length > 0) {
    latestLows[latestLows.length - 1].isLatest = true;
  }

  return [...latestHighs, ...latestLows];
}

/**
 * Detects active, unmitigated 3-candle Fair Value Gaps (FVG).
 * Any FVG completely filled by subsequent price action is excluded.
 */
export function detectActiveFVGs(candles: OHLCVCandle[], maxZones: number = 6): FairValueGapZone[] {
  if (candles.length < 4) return [];

  const active: FairValueGapZone[] = [];

  for (let i = 2; i < candles.length; i++) {
    const c0 = candles[i - 2];
    const c1 = candles[i - 1];
    const c2 = candles[i];

    // Bullish FVG: candle[i].low > candle[i-2].high
    if (c2.low > c0.high && c1.close >= c1.open) {
      const gapLow = c0.high;
      let gapHigh = c2.low;
      const minGapThreshold = c1.close * 0.0002;
      if (gapHigh - gapLow > minGapThreshold) {
        let mitigated = false;
        let partiallyMitigated = false;

        for (let j = i + 1; j < candles.length; j++) {
          if (candles[j].low <= gapLow) {
            mitigated = true;
            break;
          }
          if (candles[j].low < gapHigh) {
            partiallyMitigated = true;
            gapHigh = Math.min(gapHigh, candles[j].low);
          }
        }

        if (!mitigated && gapHigh - gapLow > minGapThreshold * 0.5) {
          active.push({
            id: `fvg-bull-${c1.time}`,
            startIndex: i - 1,
            startTime: c1.time,
            high: gapHigh,
            low: gapLow,
            direction: 'BULLISH',
            partiallyMitigated,
          });
        }
      }
    }

    // Bearish FVG: candle[i].high < candle[i-2].low
    if (c2.high < c0.low && c1.close <= c1.open) {
      let gapLow = c2.high;
      const gapHigh = c0.low;
      const minGapThreshold = c1.close * 0.0002;
      if (gapHigh - gapLow > minGapThreshold) {
        let mitigated = false;
        let partiallyMitigated = false;

        for (let j = i + 1; j < candles.length; j++) {
          if (candles[j].high >= gapHigh) {
            mitigated = true;
            break;
          }
          if (candles[j].high > gapLow) {
            partiallyMitigated = true;
            gapLow = Math.max(gapLow, candles[j].high);
          }
        }

        if (!mitigated && gapHigh - gapLow > minGapThreshold * 0.5) {
          active.push({
            id: `fvg-bear-${c1.time}`,
            startIndex: i - 1,
            startTime: c1.time,
            high: gapHigh,
            low: gapLow,
            direction: 'BEARISH',
            partiallyMitigated,
          });
        }
      }
    }
  }

  return active.slice(-maxZones);
}

/**
 * Detects active, unmitigated Orderblocks (last opposing candle prior to impulsive displacement).
 * Invalidated once subsequent price closes through the block boundary.
 */
export function detectActiveOrderBlocks(
  candles: OHLCVCandle[],
  maxZones: number = 4
): OrderBlockZone[] {
  if (candles.length < 10) return [];

  // Compute average candle range as baseline for impulsive move detection
  let rangeSum = 0;
  for (const c of candles) {
    rangeSum += Math.max(0, c.high - c.low);
  }
  const avgRange = Math.max(rangeSum / candles.length, 1e-8);

  const bullObs: OrderBlockZone[] = [];
  const bearObs: OrderBlockZone[] = [];

  for (let i = 1; i < candles.length - 2; i++) {
    const ob = candles[i];
    const next1 = candles[i + 1];
    const next2 = candles[i + 2];

    const obBody = Math.abs(ob.close - ob.open);
    const nextImpulseUp =
      next1.close > next1.open &&
      (next1.close > ob.high || next2.close > ob.high) &&
      Math.max(next1.high - next1.low, next2.high - ob.low) >= avgRange * 1.25;

    // Bullish Orderblock: bearish candle followed by strong bullish displacement
    if (ob.close < ob.open && obBody > avgRange * 0.15 && nextImpulseUp) {
      let mitigated = false;
      for (let j = i + 2; j < candles.length; j++) {
        if (candles[j].close < ob.low || candles[j].low < ob.low * 0.9995) {
          mitigated = true;
          break;
        }
      }
      if (!mitigated) {
        bullObs.push({
          id: `ob-bull-${ob.time}`,
          startIndex: i,
          startTime: ob.time,
          high: ob.high,
          low: ob.low,
          midPrice: (ob.high + ob.low) / 2,
          direction: 'BULLISH',
        });
      }
    }

    const nextImpulseDown =
      next1.close < next1.open &&
      (next1.close < ob.low || next2.close < ob.low) &&
      Math.max(next1.high - next1.low, ob.high - next2.low) >= avgRange * 1.25;

    // Bearish Orderblock: bullish candle followed by strong bearish displacement
    if (ob.close > ob.open && obBody > avgRange * 0.15 && nextImpulseDown) {
      let mitigated = false;
      for (let j = i + 2; j < candles.length; j++) {
        if (candles[j].close > ob.high || candles[j].high > ob.high * 1.0005) {
          mitigated = true;
          break;
        }
      }
      if (!mitigated) {
        bearObs.push({
          id: `ob-bear-${ob.time}`,
          startIndex: i,
          startTime: ob.time,
          high: ob.high,
          low: ob.low,
          midPrice: (ob.high + ob.low) / 2,
          direction: 'BEARISH',
        });
      }
    }
  }

  const perSide = Math.max(1, Math.floor(maxZones / 2));
  return [...bullObs.slice(-perSide), ...bearObs.slice(-perSide)];
}

/**
 * Builds normalized L2 Orderbook Heatmap bands strictly from live exchange orderbook depth.
 */
export function buildOrderbookHeatmapBands(
  liveOrderbook: OrderbookData | null | undefined,
  priceMin: number,
  priceMax: number
): OrderbookHeatmapBand[] {
  if (!liveOrderbook || !liveOrderbook.bids?.length || !liveOrderbook.asks?.length) {
    return [];
  }

  const combined: Array<{ entry: OrderbookEntry; side: 'BID' | 'ASK' }> = [];
  for (const b of liveOrderbook.bids) {
    if (b.price >= priceMin && b.price <= priceMax && b.size > 0) {
      combined.push({ entry: b, side: 'BID' });
    }
  }
  for (const a of liveOrderbook.asks) {
    if (a.price >= priceMin && a.price <= priceMax && a.size > 0) {
      combined.push({ entry: a, side: 'ASK' });
    }
  }

  if (combined.length === 0) return [];

  let maxSize = 0;
  for (const item of combined) {
    if (item.entry.size > maxSize) maxSize = item.entry.size;
  }
  if (maxSize <= 0) return [];

  return combined.map(({ entry, side }) => ({
    price: entry.price,
    size: entry.size,
    total: entry.total,
    side,
    intensity: Math.max(0.14, Math.min(1, entry.size / maxSize)),
  }));
}

/**
 * Formats large volume values compactly for POC/Bin readouts (e.g. 120, 14.5K, 2.3M).
 */
export function formatCompactVolume(vol: number): string {
  if (!Number.isFinite(vol) || vol <= 0) return '0';
  if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(2)}M`;
  if (vol >= 1_000) return `${(vol / 1_000).toFixed(1)}K`;
  if (vol >= 10) return vol.toFixed(0);
  return vol.toFixed(2);
}
