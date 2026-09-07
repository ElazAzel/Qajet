/**
 * Детерминированный PRNG (mulberry32) — сид воспроизводим байт в байт между
 * запусками `pnpm db:seed`. Без этого «сид» не был бы сидом: два прогона
 * давали бы разные графики обучения, и демонстрация была бы непроверяемой.
 */
export function createRng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: () => number, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error('pick() вызван на пустом массиве');
  return item;
}

export function pickMany<T>(rng: () => number, items: readonly T[], count: number): T[] {
  const pool = [...items];
  const result: T[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(rng() * pool.length);
    const [item] = pool.splice(idx, 1);
    if (item !== undefined) result.push(item);
  }
  return result;
}

/** Целое в диапазоне [min, max], включительно. */
export function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}
