import {
  fitLogLogRegression,
  type LogLogRegression,
  type PriceObservation,
  quantile,
} from '../estimate/estimate.js';
import {
  calculateSupplierReliability,
  type SupplierLeadHistoryEntry,
  type SupplierReliability,
} from '../leadtime/predict.js';
import {
  DEFAULT_WEIGHTS,
  type MatchWeights,
  type ScoringFeatures,
  sgdUpdate,
} from '../match/match.js';

/**
 * Контур обучения — agents.md §8G. `recalibrate()` вызывается при каждом
 * закрытии заказа и по крону раз в сутки; здесь — только пересчёт, запись
 * `model_snapshots` в БД остаётся за вызывающим кодом (движок не трогает
 * сеть и хранилище).
 */

// ---------------------------------------------------------------------------
// Калькулятор — коэффициенты регрессии и квантиль запаса по категориям
// ---------------------------------------------------------------------------

export interface CategoryHistory {
  category: string;
  observations: readonly PriceObservation[];
  /** (факт − p50) / p50 по прошлым закрытым заказам этой категории. */
  relativeErrors: readonly number[];
}

export interface EstimatorSnapshot {
  category: string;
  regression: LogLogRegression | null;
  marginPct: number;
  /** MAPE — среднее абсолютное относительное отклонение оценки от факта. */
  mape: number;
  nSamples: number;
}

const DEFAULT_MARGIN_PCT = 0.25;
const MIN_MARGIN_PCT = 0.05;

export function recalibrateEstimators(histories: readonly CategoryHistory[]): EstimatorSnapshot[] {
  return histories.map((h) => {
    const regression = fitLogLogRegression(h.observations);
    const marginPct =
      h.relativeErrors.length > 0
        ? Math.max(MIN_MARGIN_PCT, quantile(h.relativeErrors, 0.8))
        : DEFAULT_MARGIN_PCT;
    const mape =
      h.relativeErrors.length > 0
        ? h.relativeErrors.reduce((s, e) => s + Math.abs(e), 0) / h.relativeErrors.length
        : Number.NaN;
    return {
      category: h.category,
      regression,
      marginPct,
      mape,
      nSamples: h.relativeErrors.length,
    };
  });
}

// ---------------------------------------------------------------------------
// Матчер — веса дообучаются батчем исходов с момента прошлой калибровки
// ---------------------------------------------------------------------------

export interface MatchOutcome {
  features: ScoringFeatures;
  target: 0 | 1;
}

export interface MatchWeightsSnapshot {
  weights: MatchWeights;
  nSamples: number;
}

export function recalibrateMatchWeights(
  outcomes: readonly MatchOutcome[],
  startingWeights: MatchWeights = DEFAULT_WEIGHTS,
  learningRate = 0.05,
): MatchWeightsSnapshot {
  let weights = startingWeights;
  for (const outcome of outcomes) {
    weights = sgdUpdate(weights, outcome.features, outcome.target, learningRate);
  }
  return { weights, nSamples: outcomes.length };
}

// ---------------------------------------------------------------------------
// Срок — коэффициент надёжности k пересчитывается по каждому поставщику
// ---------------------------------------------------------------------------

export interface SupplierLeadHistory {
  supplierId: string;
  history: readonly SupplierLeadHistoryEntry[];
}

export interface LeadTimeSnapshot {
  supplierId: string;
  reliability: SupplierReliability;
}

export function recalibrateLeadTimes(
  suppliers: readonly SupplierLeadHistory[],
): LeadTimeSnapshot[] {
  return suppliers.map((s) => ({
    supplierId: s.supplierId,
    reliability: calculateSupplierReliability(s.history),
  }));
}

// ---------------------------------------------------------------------------
// Рейтинги поставщика — agents.md §8F: три отдельных числа + N, без сводного балла
// ---------------------------------------------------------------------------

export interface OrderOutcome {
  wasOnTime: boolean;
  hadDispute: boolean;
  buyerScore: number | null;
}

export interface SupplierStatsSnapshot {
  ordersTotal: number;
  onTimeRate: number;
  noDisputeRate: number;
  avgBuyerScore: number | null;
}

export function recalibrateSupplierStats(outcomes: readonly OrderOutcome[]): SupplierStatsSnapshot {
  const ordersTotal = outcomes.length;
  if (ordersTotal === 0) {
    return { ordersTotal: 0, onTimeRate: 0, noDisputeRate: 0, avgBuyerScore: null };
  }
  const onTimeCount = outcomes.filter((o) => o.wasOnTime).length;
  const noDisputeCount = outcomes.filter((o) => !o.hadDispute).length;
  const scored = outcomes.filter((o) => o.buyerScore !== null).map((o) => o.buyerScore as number);
  return {
    ordersTotal,
    onTimeRate: onTimeCount / ordersTotal,
    noDisputeRate: noDisputeCount / ordersTotal,
    avgBuyerScore: scored.length > 0 ? scored.reduce((s, v) => s + v, 0) / scored.length : null,
  };
}

// ---------------------------------------------------------------------------
// Полный прогон
// ---------------------------------------------------------------------------

export interface RecalibrateInput {
  estimatorHistories: readonly CategoryHistory[];
  matchOutcomes: readonly MatchOutcome[];
  matchStartingWeights?: MatchWeights;
  leadTimeSuppliers: readonly SupplierLeadHistory[];
  /** Ключ — supplierId. */
  supplierOutcomes: ReadonlyMap<string, readonly OrderOutcome[]>;
  /** ISO-дата прогона — передаётся явно, движок не читает системные часы. */
  now: string;
}

export interface RecalibrateResult {
  estimators: EstimatorSnapshot[];
  match: MatchWeightsSnapshot;
  leadTimes: LeadTimeSnapshot[];
  supplierStats: Map<string, SupplierStatsSnapshot>;
  recalibratedAt: string;
}

/** Полный прогон обучения — один вызов на каждое закрытие заказа и раз в сутки по крону. */
export function recalibrate(input: RecalibrateInput): RecalibrateResult {
  const supplierStats = new Map<string, SupplierStatsSnapshot>();
  for (const [supplierId, outcomes] of input.supplierOutcomes) {
    supplierStats.set(supplierId, recalibrateSupplierStats(outcomes));
  }

  return {
    estimators: recalibrateEstimators(input.estimatorHistories),
    match: recalibrateMatchWeights(input.matchOutcomes, input.matchStartingWeights),
    leadTimes: recalibrateLeadTimes(input.leadTimeSuppliers),
    supplierStats,
    recalibratedAt: input.now,
  };
}
