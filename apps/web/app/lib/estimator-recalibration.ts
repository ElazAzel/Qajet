export interface EstimatorErrorHistory {
  category: string;
  relativeErrors?: readonly number[] | undefined;
}

export function appendEstimatorError(
  previous: readonly EstimatorErrorHistory[],
  categories: readonly string[],
  relativeError: number,
  windowSize = 6,
): Map<string, number[]> {
  const histories = new Map(
    previous.map((entry) => [entry.category, [...(entry.relativeErrors ?? [])]]),
  );
  if (!Number.isFinite(relativeError) || windowSize <= 0) return histories;

  for (const category of new Set(categories)) {
    histories.set(category, [...(histories.get(category) ?? []), relativeError].slice(-windowSize));
  }
  return histories;
}

export function itemKeyForEstimator(specs: unknown, fallbackCategory: string): string {
  if (
    typeof specs === 'object' &&
    specs !== null &&
    'itemKey' in specs &&
    typeof specs.itemKey === 'string' &&
    specs.itemKey.trim()
  ) {
    return specs.itemKey.trim();
  }
  return fallbackCategory;
}
