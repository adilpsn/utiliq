import { addMinutes, format, startOfDay } from "date-fns";
import { nowIso } from "./clock";
import { gridFlowAt, parseDate } from "./utiliq-engine";
import type { EnergyConstraint, PricePoint, UtiliqState } from "./utiliq-types";

/**
 * Spot-market analysis.
 *
 * Conceptual model: the day-ahead spot price for exported energy is the
 * facility's feed-in tariff curve. The plant earns the spot price for every
 * MWh it pushes onto the grid. This module turns the sparse price profile into
 * an hourly curve, overlays the scheduled net export, and quantifies how well
 * export timing is aligned with high-price windows.
 *
 * All functions are pure — no mutation, no Date.now()/random.
 */

export type SpotHour = {
  hour: number;
  time: string;
  spotPrice: number; // €/MWh earned for export this hour
  exportMW: number; // scheduled net export (≥ 0; 0 when importing)
  revenueEUR: number; // exportMW * 1h * spotPrice
};

export type SpotAnalysis = {
  hours: SpotHour[];
  exportedMWh: number;
  realizedRevenueEUR: number;
  avgCapturedPriceEUR: number; // revenue-weighted price actually captured
  avgSpotPriceEUR: number; // flat day average
  peakPriceEUR: number;
  peakHour: number;
  troughPriceEUR: number;
  optimalRevenueEUR: number; // same MWh sold into the highest-price hours
  missedRevenueEUR: number; // optimal − realized
  alignmentPct: number; // realized / optimal, 0–100
  recommendations: SpotRecommendation[];
};

export type SpotRecommendation = {
  fromHour: number;
  toHour: number;
  energyMWh: number;
  gainEUR: number;
  message: string;
};

const HOURS_IN_DAY = 24;

/** Linear interpolation of a sparse {time, eurPerMWh} profile to a given hour. */
export function interpolatePrice(
  profile: PricePoint[] | undefined,
  hour: number,
  fallback: number,
): number {
  if (!profile?.length) return fallback;
  const points = [...profile]
    .map((p) => ({ hour: Number(p.time.slice(0, 2)), price: p.eurPerMWh }))
    .sort((a, b) => a.hour - b.hour);

  if (hour <= points[0].hour) return points[0].price;
  if (hour >= points[points.length - 1].hour) return points[points.length - 1].price;

  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (hour >= a.hour && hour <= b.hour) {
      const span = b.hour - a.hour;
      if (span === 0) return a.price;
      const t = (hour - a.hour) / span;
      return a.price + (b.price - a.price) * t;
    }
  }
  return fallback;
}

/** Hourly spot-export price curve for the day. */
export function buildSpotCurve(
  constraint: EnergyConstraint,
  day = parseDate(nowIso()),
): { hour: number; time: string; spotPrice: number }[] {
  const base = startOfDay(day);
  return Array.from({ length: HOURS_IN_DAY }, (_, hour) => {
    const at = addMinutes(base, hour * 60);
    return {
      hour,
      time: format(at, "HH:mm"),
      spotPrice: Number(interpolatePrice(constraint.feedInTariffProfile, hour, 58).toFixed(1)),
    };
  });
}

/**
 * Greedy upper bound on revenue: sell the same total exported energy into the
 * highest-priced hours first, capped by the grid export limit each hour.
 */
function optimalRevenue(
  exportedMWh: number,
  curve: { hour: number; spotPrice: number }[],
  exportCapMW: number,
): number {
  let remaining = exportedMWh;
  let revenue = 0;
  const byPrice = [...curve].sort((a, b) => b.spotPrice - a.spotPrice);
  for (const slot of byPrice) {
    if (remaining <= 0) break;
    const take = Math.min(exportCapMW, remaining); // 1h window
    revenue += take * slot.spotPrice;
    remaining -= take;
  }
  return revenue;
}

export function analyzeSpotMarket(state: UtiliqState, day = parseDate(nowIso())): SpotAnalysis {
  const constraint = state.energyConstraint;
  const curve = buildSpotCurve(constraint, day);
  const base = startOfDay(day);
  const exportCap = Math.max(0.1, constraint.maxGridExportMW);

  const hours: SpotHour[] = curve.map(({ hour, time, spotPrice }) => {
    const at = addMinutes(base, hour * 60);
    const flow = gridFlowAt(state.assignments, state.testItems, constraint, at);
    const exportMW = Math.max(0, flow);
    return {
      hour,
      time,
      spotPrice,
      exportMW: Number(exportMW.toFixed(2)),
      revenueEUR: Number((exportMW * spotPrice).toFixed(1)),
    };
  });

  const exportedMWh = hours.reduce((sum, h) => sum + h.exportMW, 0);
  const realizedRevenueEUR = hours.reduce((sum, h) => sum + h.revenueEUR, 0);
  const avgCapturedPriceEUR = exportedMWh > 0 ? realizedRevenueEUR / exportedMWh : 0;
  const avgSpotPriceEUR = curve.reduce((sum, c) => sum + c.spotPrice, 0) / curve.length;

  const peak = curve.reduce((best, c) => (c.spotPrice > best.spotPrice ? c : best), curve[0]);
  const trough = curve.reduce((worst, c) => (c.spotPrice < worst.spotPrice ? c : worst), curve[0]);

  const optimalRevenueEUR = optimalRevenue(exportedMWh, curve, exportCap);
  const missedRevenueEUR = Math.max(0, optimalRevenueEUR - realizedRevenueEUR);
  const alignmentPct =
    optimalRevenueEUR > 0
      ? Math.min(100, Math.round((realizedRevenueEUR / optimalRevenueEUR) * 100))
      : 0;

  return {
    hours,
    exportedMWh: Number(exportedMWh.toFixed(2)),
    realizedRevenueEUR: Number(realizedRevenueEUR.toFixed(0)),
    avgCapturedPriceEUR: Number(avgCapturedPriceEUR.toFixed(1)),
    avgSpotPriceEUR: Number(avgSpotPriceEUR.toFixed(1)),
    peakPriceEUR: Number(peak.spotPrice.toFixed(1)),
    peakHour: peak.hour,
    troughPriceEUR: Number(trough.spotPrice.toFixed(1)),
    optimalRevenueEUR: Number(optimalRevenueEUR.toFixed(0)),
    missedRevenueEUR: Number(missedRevenueEUR.toFixed(0)),
    alignmentPct,
    recommendations: buildRecommendations(hours, exportCap),
  };
}

/**
 * Suggest moving export out of below-average-price hours into the best
 * remaining headroom in above-average-price hours.
 */
function buildRecommendations(hours: SpotHour[], exportCapMW: number): SpotRecommendation[] {
  const avg = hours.reduce((sum, h) => sum + h.spotPrice, 0) / hours.length;
  // Hours we'd like to shift away from: exporting during cheap windows.
  const cheapExports = hours
    .filter((h) => h.exportMW > 0.05 && h.spotPrice < avg)
    .sort((a, b) => a.spotPrice - b.spotPrice);
  // Hours with spare export headroom at premium prices.
  const premiumHeadroom = hours
    .filter((h) => h.spotPrice > avg && h.exportMW < exportCapMW - 0.05)
    .map((h) => ({ ...h, headroom: exportCapMW - h.exportMW }))
    .sort((a, b) => b.spotPrice - a.spotPrice);

  const recs: SpotRecommendation[] = [];
  // Greedy pairing — don't double-count headroom.
  const headroomLeft = new Map(premiumHeadroom.map((h) => [h.hour, h.headroom]));

  for (const cheap of cheapExports) {
    let toMove = cheap.exportMW;
    for (const target of premiumHeadroom) {
      if (toMove <= 0.05) break;
      const avail = headroomLeft.get(target.hour) ?? 0;
      if (avail <= 0.05) continue;
      const moved = Math.min(toMove, avail);
      const gain = moved * (target.spotPrice - cheap.spotPrice);
      if (gain < 1) continue;
      recs.push({
        fromHour: cheap.hour,
        toHour: target.hour,
        energyMWh: Number(moved.toFixed(2)),
        gainEUR: Number(gain.toFixed(0)),
        message: `Shift ${moved.toFixed(1)} MWh from ${cheap.time} (€${cheap.spotPrice}/MWh) to ${target.time} (€${target.spotPrice}/MWh) → +€${gain.toFixed(0)}`,
      });
      headroomLeft.set(target.hour, avail - moved);
      toMove -= moved;
    }
  }
  return recs.sort((a, b) => b.gainEUR - a.gainEUR).slice(0, 5);
}
