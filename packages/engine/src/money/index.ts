/**
 * Деньги — agents.md: целые числа, ни одного float. Все суммы в продукте —
 * целые тенге (bigint в mode:'number' на границе с БД). Тиын не участвует:
 * на практике в РК не используется, а плавающая точка — источник ошибок
 * округления, которые первыми ломаются в подобных продуктах.
 */

export type Kzt = number;

/** Округление до целого тенге. Единственное место, где это делается руками. */
export function roundKzt(value: number): Kzt {
  return Math.round(value);
}

export function sumKzt(values: readonly Kzt[]): Kzt {
  return values.reduce((total, v) => total + v, 0);
}

/**
 * Метод наибольшего остатка: делит `total` пропорционально `weights` на
 * целые тенге так, чтобы сумма частей была РОВНО равна total — а не почти
 * равна из-за независимого округления каждой доли. Именно так распределяется
 * скидка/комиссия по строкам, чтобы ведомость сходилась до тенге.
 */
export function distributeProportionally(total: Kzt, weights: readonly number[]): Kzt[] {
  if (weights.length === 0) return [];
  const weightSum = sumKzt(weights);
  if (weightSum <= 0) {
    // Нет базы для пропорции — отдать всё первому, остальным ноль,
    // сумма всё равно обязана сойтись с total.
    return weights.map((_, i) => (i === 0 ? total : 0));
  }

  const raw = weights.map((w) => (total * w) / weightSum);
  const floors = raw.map(Math.floor);
  let remainder = total - sumKzt(floors);

  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac);

  const result = [...floors];
  for (const { i } of order) {
    if (remainder <= 0) break;
    const r = result[i];
    if (r === undefined) continue;
    result[i] = r + 1;
    remainder -= 1;
  }
  return result;
}

/** Процент от суммы, округлённый до целого тенге. */
export function percentOfKzt(amount: Kzt, pct: number): Kzt {
  return roundKzt((amount * pct) / 100);
}
