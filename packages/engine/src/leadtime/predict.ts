/**
 * Прогноз срока — agents.md §8E.
 *
 * До КП поставщика мы не знаем ничего, кроме прошлых заказов категории —
 * медиана факта. После КП есть заявленный срок конкретного поставщика,
 * который корректируется его личным коэффициентом надёжности `k`,
 * стянутым к 1.0 при малой истории (shrinkage, тот же принцип §8).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    const v = sorted[mid];
    if (v === undefined) return 0;
    return v;
  }
  const a = sorted[mid - 1];
  const b = sorted[mid];
  if (a === undefined || b === undefined) return 0;
  return (a + b) / 2;
}

/** До получения КП — медианный фактический срок исполнения по категории. */
export function predictBeforeQuote(historicalActualDays: readonly number[]): number {
  return median(historicalActualDays);
}

export interface SupplierLeadHistoryEntry {
  declaredDays: number;
  actualDays: number;
}

export interface SupplierReliability {
  /** Медиана факт/заявлено по истории поставщика. */
  k: number;
  /** Сдвинутый к 1.0 коэффициент — то, что реально применяется в прогнозе. */
  kShrunk: number;
  nSamples: number;
}

/**
 * Коэффициент надёжности поставщика по сроку: k = медиана(факт/заявлено).
 * Сдвиг к базовому 1.0 при малом N: k' = (N·k + 3·1.0) / (N + 3).
 */
export function calculateSupplierReliability(
  history: readonly SupplierLeadHistoryEntry[],
): SupplierReliability {
  const ratios = history
    .filter((h) => h.declaredDays > 0)
    .map((h) => h.actualDays / h.declaredDays);
  const n = ratios.length;
  const k = median(ratios);
  const kShrunk = (n * k + 3 * 1.0) / (n + 3);
  return { k, kShrunk, nSamples: n };
}

export interface PredictAfterQuoteInput {
  declaredLeadDays: number;
  supplierHistory: readonly SupplierLeadHistoryEntry[];
  /** Буфер логистики по городу доставки — Алматы 1 день, межгород по таблице у вызывающего кода. */
  logisticsBufferDays: number;
}

export interface LeadTimePrediction {
  predictedDays: number;
  reliability: SupplierReliability;
}

/** После получения КП — прогноз = заявленный срок × k' поставщика + буфер логистики. */
export function predictAfterQuote(input: PredictAfterQuoteInput): LeadTimePrediction {
  const reliability = calculateSupplierReliability(input.supplierHistory);
  const predictedDays = input.declaredLeadDays * reliability.kShrunk + input.logisticsBufferDays;
  return { predictedDays, reliability };
}

/**
 * slack_days = дедлайн − прогноз. Точка отсчёта прогноза — дата старта
 * (обычно дата отправки RFQ или дата принятия плана), не "сегодня".
 */
export function calculateSlackDays(
  startDate: Date,
  predictedDays: number,
  deadlineDate: Date,
): number {
  const predictedArrivalMs = startDate.getTime() + predictedDays * DAY_MS;
  return Math.floor((deadlineDate.getTime() - predictedArrivalMs) / DAY_MS);
}
