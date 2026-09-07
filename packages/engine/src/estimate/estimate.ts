import type { Kzt } from '../money/index.js';
import { roundKzt } from '../money/index.js';

/**
 * Калькулятор предоплаты — agents.md §8B.
 *
 * До получения КП нужно честно назвать сумму счёта на предоплату и степень
 * уверенности в ней. Модель эффекта тиража + байесово сглаживание к базовой
 * ставке при малой истории + запас как P80-квантиль прошлых ошибок, а не
 * константа — три требования спеки, реализованные ниже дословно.
 */

export interface PriceObservation {
  qty: number;
  unitPriceKzt: Kzt;
}

export interface EstimateInput {
  qty: number;
  observations: readonly PriceObservation[];
  /** Стартовая справочная ставка за единицу для категории — из сид-данных, помечена как стартовая. */
  baseRateKzt: Kzt;
  /**
   * Относительные ошибки прошлых оценок этой категории: (факт − p50) / p50.
   * Пусто → запас берётся стартовым 25% (agents.md §8B).
   */
  pastRelativeErrors?: readonly number[];
  lastObservedAt?: string;
}

export interface EstimateBasis {
  nSamples: number;
  lastObservedAt: string | undefined;
  /** λ — доля оценки, пришедшая из истории, а не из стартовой ставки. */
  shareFromHistory: number;
}

export interface EstimateResult {
  p50Kzt: Kzt;
  p80Kzt: Kzt;
  marginPct: number;
  basis: EstimateBasis;
}

const SMOOTHING_K = 8;
const DEFAULT_MARGIN_PCT = 0.25;
/** Запас никогда не уходит в ноль/отрицательное — минимальная защита от переобучения на "везучей" истории. */
const MIN_MARGIN_PCT = 0.05;

export interface LogLogRegression {
  a: number;
  b: number;
}

/**
 * МНК для ln(unitPrice) = a + b·ln(qty). Возвращает null, если точек
 * недостаточно для регрессии. Экспортируется отдельно от `estimate()` —
 * `learn/recalibrate.ts` пересчитывает эти же коэффициенты по категориям
 * без дублирования формулы.
 */
export function fitLogLogRegression(points: readonly PriceObservation[]): LogLogRegression | null {
  const valid = points.filter((p) => p.qty > 0 && p.unitPriceKzt > 0);
  // Регрессии по одной точке или по единственному значению qty не существует —
  // наклон b неопределён (деление на нулевую дисперсию x).
  const distinctQty = new Set(valid.map((p) => p.qty)).size;
  if (valid.length < 2 || distinctQty < 2) return null;

  const xs = valid.map((p) => Math.log(p.qty));
  const ys = valid.map((p) => Math.log(p.unitPriceKzt));
  const n = xs.length;
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    if (x === undefined || y === undefined) continue;
    num += (x - meanX) * (y - meanY);
    den += (x - meanX) ** 2;
  }
  if (den === 0) return null;

  const b = num / den;
  const a = meanY - b * meanX;
  return { a, b };
}

/** Линейная интерполяция квантиля по отсортированной выборке (стандартный способ, без внешних зависимостей). */
export function quantile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const loVal = sorted[lo];
  const hiVal = sorted[hi];
  if (loVal === undefined || hiVal === undefined) return Number.NaN;
  if (lo === hi) return loVal;
  return loVal + (hiVal - loVal) * (idx - lo);
}

export function estimate(input: EstimateInput): EstimateResult {
  const regression = fitLogLogRegression(input.observations);
  const n = input.observations.length;
  const lambda = n / (n + SMOOTHING_K);

  const modeledUnitPrice = regression
    ? Math.exp(regression.a + regression.b * Math.log(input.qty))
    : input.baseRateKzt;

  const effectiveLambda = regression ? lambda : 0;
  const blendedUnitPrice =
    effectiveLambda * modeledUnitPrice + (1 - effectiveLambda) * input.baseRateKzt;

  const p50Kzt = roundKzt(blendedUnitPrice * input.qty);

  const marginPct =
    input.pastRelativeErrors && input.pastRelativeErrors.length > 0
      ? Math.max(MIN_MARGIN_PCT, quantile(input.pastRelativeErrors, 0.8))
      : DEFAULT_MARGIN_PCT;

  const p80Kzt = roundKzt(p50Kzt * (1 + marginPct));

  return {
    p50Kzt,
    p80Kzt,
    marginPct,
    basis: {
      nSamples: n,
      lastObservedAt: input.lastObservedAt,
      shareFromHistory: effectiveLambda,
    },
  };
}
