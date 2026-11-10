/**
 * Комиссия платформы по позиции плана — по умолчанию плоский процент из
 * `settings` (agents.md §7), но консьерж может задать другой процент для
 * конкретной позиции в диапазоне 10-15% (объём, сложность исполнения и
 * т.д.). Здесь — только чистые правила диапазона и подсказка на основе
 * прошлых правок консьержа; сама запись и агрегация — в apps/web
 * (server actions), это исключительно бизнес-правило без побочных
 * эффектов, тем же приёмом, что normalizeText/resolveAlias в intake.
 */

export const COMMISSION_DEFAULT_PCT = 15;
export const COMMISSION_MIN_PCT = 10;
export const COMMISSION_MAX_PCT = 15;

/** Тот же порог, что ALIAS_AUTO_APPLY_HITS_THRESHOLD (intake/parse.ts) —
 *  подсказка появляется только когда накопилось достаточно решений
 *  консьержа по этой категории, иначе это не сигнал, а шум. */
export const COMMISSION_SUGGESTION_MIN_SAMPLES = 3;

export function isValidCommissionPct(pct: number): boolean {
  return Number.isFinite(pct) && pct >= COMMISSION_MIN_PCT && pct <= COMMISSION_MAX_PCT;
}

export interface CommissionOverrideSample {
  category: string;
  pct: number;
}

export interface CommissionSuggestion {
  pct: number;
  sampleCount: number;
}

/**
 * Подсказка, не авто-применение (тот же принцип, что categoryHint в
 * quick-add и алиасы категорий — волна 1, шаг 5): усредняет прошлые
 * правки консьержа по этой же категории и предлагает округлённый,
 * заклампленный в допустимый диапазон процент. Решение всё равно за
 * человеком — вызывающий код только показывает эту подсказку.
 */
export function suggestCommissionPct(
  category: string,
  samples: readonly CommissionOverrideSample[],
): CommissionSuggestion | null {
  const matching = samples.filter((s) => s.category === category);
  if (matching.length < COMMISSION_SUGGESTION_MIN_SAMPLES) return null;

  const avg = matching.reduce((sum, s) => sum + s.pct, 0) / matching.length;
  const clamped = Math.min(COMMISSION_MAX_PCT, Math.max(COMMISSION_MIN_PCT, Math.round(avg)));
  return { pct: clamped, sampleCount: matching.length };
}
