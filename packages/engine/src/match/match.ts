/**
 * Подбор поставщиков под RFQ — agents.md §8C.
 *
 * Жёсткие фильтры отсекают то, что физически не подходит, до всякого
 * скоринга. Прошедшие ранжируются взвешенной суммой признаков, веса
 * которой дообучаются онлайн логистической регрессией с SGD. Отдельно —
 * слот исследования: без него сеть поставщиков никогда не растёт, потому
 * что у новых просто нет истории, чтобы набрать высокий скор честно.
 */

// ---------------------------------------------------------------------------
// Жёсткие фильтры
// ---------------------------------------------------------------------------

export interface SupplierCandidate {
  id: string;
  isActive: boolean;
  isVerified: boolean;
  isBlocked: boolean;
  categories: readonly string[];
  capabilities: readonly string[];
  minOrderKzt: number | null;
  /** null — поставщик обслуживает любой город (например самовывоз/доставка почтой). */
  servesCities: readonly string[] | null;
}

export interface HardFilterRequest {
  category: string;
  requiredCapabilities: readonly string[];
  orderValueKzt: number;
  city: string;
}

export type FilterRejectionReason =
  | 'inactive'
  | 'not_verified'
  | 'blocked'
  | 'category_mismatch'
  | 'missing_capability'
  | 'below_min_order'
  | 'city_not_served';

export interface FilterResult {
  passes: boolean;
  reason?: FilterRejectionReason;
}

function normalizeCity(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
}

export function passesHardFilters(
  candidate: SupplierCandidate,
  request: HardFilterRequest,
): FilterResult {
  if (candidate.isBlocked) return { passes: false, reason: 'blocked' };
  if (!candidate.isActive) return { passes: false, reason: 'inactive' };
  if (!candidate.isVerified) return { passes: false, reason: 'not_verified' };
  if (!candidate.categories.includes(request.category)) {
    return { passes: false, reason: 'category_mismatch' };
  }
  const missingCapability = request.requiredCapabilities.some(
    (cap) => !candidate.capabilities.includes(cap),
  );
  if (missingCapability) return { passes: false, reason: 'missing_capability' };
  if (candidate.minOrderKzt !== null && request.orderValueKzt < candidate.minOrderKzt) {
    return { passes: false, reason: 'below_min_order' };
  }
  if (
    candidate.servesCities !== null &&
    !candidate.servesCities.some((city) => normalizeCity(city) === normalizeCity(request.city))
  ) {
    return { passes: false, reason: 'city_not_served' };
  }
  return { passes: true };
}

// ---------------------------------------------------------------------------
// Скоринг и онлайн-обучение весов (логистическая регрессия, SGD)
// ---------------------------------------------------------------------------

/**
 * Признаки уже нормализованы к 0..1 вызывающим кодом (скорость ответа,
 * свежесть сделки и т.п. — величины разной природы, приводить их к общей
 * шкале не задача матчера).
 */
export interface ScoringFeatures {
  categoryMatch: number;
  onTimeRate: number;
  noDisputeRate: number;
  responseSpeedScore: number;
  winRate: number;
  freshnessScore: number;
  currentLoad: number;
}

/** Порядок весов зеркалит порядок признаков — dot product, без магии. */
export interface MatchWeights {
  categoryMatch: number;
  onTimeRate: number;
  noDisputeRate: number;
  responseSpeedScore: number;
  winRate: number;
  freshnessScore: number;
  currentLoad: number;
}

/** Разумные стартовые веса — currentLoad отрицательный, остальное поощряется поровну. */
export const DEFAULT_WEIGHTS: MatchWeights = {
  categoryMatch: 1,
  onTimeRate: 1,
  noDisputeRate: 1,
  responseSpeedScore: 0.5,
  winRate: 0.5,
  freshnessScore: 0.3,
  currentLoad: -0.5,
};

const FEATURE_KEYS = [
  'categoryMatch',
  'onTimeRate',
  'noDisputeRate',
  'responseSpeedScore',
  'winRate',
  'freshnessScore',
  'currentLoad',
] as const satisfies readonly (keyof ScoringFeatures)[];

export function scoreSupplier(
  features: ScoringFeatures,
  weights: MatchWeights = DEFAULT_WEIGHTS,
): number {
  let score = 0;
  for (const key of FEATURE_KEYS) {
    score += weights[key] * features[key];
  }
  return score;
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/** Вероятность "поставщик пришлёт допустимое КП в срок" по текущим весам. */
export function predictSuccessProbability(
  features: ScoringFeatures,
  weights: MatchWeights = DEFAULT_WEIGHTS,
): number {
  return sigmoid(scoreSupplier(features, weights));
}

/**
 * Один шаг онлайн-обучения (SGD) логистической регрессии:
 * w_i += learningRate · (target − predicted) · x_i.
 * target ∈ {0,1} — фактический исход ("КП пришло вовремя и было допустимо",
 * либо более сильный сигнал "строка вошла в утверждённый план").
 */
export function sgdUpdate(
  weights: MatchWeights,
  features: ScoringFeatures,
  target: 0 | 1,
  learningRate: number,
): MatchWeights {
  const predicted = predictSuccessProbability(features, weights);
  const error = target - predicted;
  const updated = { ...weights };
  for (const key of FEATURE_KEYS) {
    updated[key] = weights[key] + learningRate * error * features[key];
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Слот исследования — Thompson sampling по бета-распределению
// ---------------------------------------------------------------------------

/** Box–Muller — стандартная нормаль из равномерного генератора. */
function sampleStandardNormal(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Marsaglia–Tsang для shape ≥ 1, с усилением Ahrens–Dieter для shape < 1. */
function sampleGamma(shape: number, rng: () => number): number {
  if (shape < 1) {
    const u = rng();
    return sampleGamma(shape + 1, rng) * u ** (1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = sampleStandardNormal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x ** 2 + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Beta(a,b) через два независимых Gamma-розыгрыша: X/(X+Y). */
export function sampleBeta(alpha: number, beta: number, rng: () => number = Math.random): number {
  const x = sampleGamma(alpha, rng);
  const y = sampleGamma(beta, rng);
  return x / (x + y);
}

export interface ExplorationCandidate {
  id: string;
  successCount: number;
  failCount: number;
}

/**
 * Выбирает поставщика для слота исследования из пула с малой историей:
 * сэмплирует Beta(successCount+1, failCount+1) для каждого (априор
 * Beta(1,1) — равномерный при нулевой истории) и берёт максимум сэмпла.
 * Именно это даёт новым поставщикам реальный шанс, а не символический.
 */
export function pickExplorationCandidate(
  candidates: readonly ExplorationCandidate[],
  rng: () => number = Math.random,
): string | null {
  let bestId: string | null = null;
  let bestSample = Number.NEGATIVE_INFINITY;
  for (const c of candidates) {
    const sample = sampleBeta(c.successCount + 1, c.failCount + 1, rng);
    if (sample > bestSample) {
      bestSample = sample;
      bestId = c.id;
    }
  }
  return bestId;
}

/** Один слот из каждых `everyN` рассылаемых RFQ — agents.md §8C. */
export function isExplorationSlot(indexInBatch: number, everyN: number): boolean {
  if (everyN <= 0) return false;
  return indexInBatch % everyN === 0;
}
