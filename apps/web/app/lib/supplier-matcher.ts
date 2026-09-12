import type { ScoringFeatures } from '@qajet/engine/match';

export interface SupplierMatcherStats {
  ordersTotal: number;
  ordersOnTime: number;
  ordersDisputed: number;
  rfqSent: number;
  medianResponseHours: number | null;
}

export interface SupplierMatcherActivity {
  openOrderCount: number;
  lastClosedAt: string | null;
}

const SLOW_RESPONSE_HOURS_REFERENCE = 48;
const FRESHNESS_WINDOW_DAYS = 180;
const OPEN_ORDER_LOAD_REFERENCE = 5;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Converts supplier history into the normalized features consumed by the
 * deterministic matcher. Missing history remains neutral; known activity
 * contributes freshness and load instead of being silently discarded.
 */
export function matcherFeatures(
  stats: SupplierMatcherStats,
  activity: SupplierMatcherActivity,
  nowIso = new Date().toISOString(),
): ScoringFeatures {
  const hasHistory = stats.ordersTotal > 0;
  const lastClosedAt = activity.lastClosedAt ? Date.parse(activity.lastClosedAt) : Number.NaN;
  const now = Date.parse(nowIso);
  const ageDays =
    Number.isFinite(lastClosedAt) && Number.isFinite(now)
      ? Math.max(0, (now - lastClosedAt) / (24 * 60 * 60 * 1000))
      : null;

  return {
    categoryMatch: 1,
    onTimeRate: hasHistory ? clamp01(stats.ordersOnTime / stats.ordersTotal) : 0.5,
    noDisputeRate: hasHistory ? clamp01(1 - stats.ordersDisputed / stats.ordersTotal) : 0.5,
    responseSpeedScore:
      stats.medianResponseHours !== null
        ? clamp01(1 - stats.medianResponseHours / SLOW_RESPONSE_HOURS_REFERENCE)
        : 0.5,
    winRate: stats.rfqSent > 0 ? clamp01(stats.ordersTotal / stats.rfqSent) : 0.5,
    freshnessScore: ageDays === null ? 0.5 : clamp01(1 - ageDays / FRESHNESS_WINDOW_DAYS),
    currentLoad: clamp01(Math.max(0, activity.openOrderCount) / OPEN_ORDER_LOAD_REFERENCE),
  };
}
