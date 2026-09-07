import { describe, expect, it } from 'vitest';
import { distributeProportionally, percentOfKzt, roundKzt, sumKzt } from './index.js';

describe('roundKzt', () => {
  it('округляет к ближайшему целому', () => {
    expect(roundKzt(1000.4)).toBe(1000);
    expect(roundKzt(1000.5)).toBe(1001);
    expect(roundKzt(999.5)).toBe(1000);
  });
});

describe('sumKzt', () => {
  it('суммирует целые тенге', () => {
    expect(sumKzt([100, 200, 300])).toBe(600);
    expect(sumKzt([])).toBe(0);
  });
});

describe('distributeProportionally', () => {
  it('сумма частей всегда равна total, даже когда независимое округление не сошлось бы', () => {
    // 100 / 3 = 33.33... — наивное округление каждой доли даст 33+33+33=99, не 100.
    const parts = distributeProportionally(100, [1, 1, 1]);
    expect(sumKzt(parts)).toBe(100);
    expect(parts).toEqual([34, 33, 33]);
  });

  it('распределяет пропорционально весам', () => {
    const parts = distributeProportionally(1000, [3, 1]);
    expect(parts).toEqual([750, 250]);
    expect(sumKzt(parts)).toBe(1000);
  });

  it('при нулевой сумме весов отдаёт всё первому, сумма всё равно сходится', () => {
    const parts = distributeProportionally(500, [0, 0, 0]);
    expect(parts).toEqual([500, 0, 0]);
  });

  it('пустой список весов — пустой результат', () => {
    expect(distributeProportionally(500, [])).toEqual([]);
  });

  it('устойчиво к большому числу строк с некруглыми весами', () => {
    const weights = Array.from({ length: 11 }, (_, i) => i + 1);
    const parts = distributeProportionally(1_000_000, weights);
    expect(sumKzt(parts)).toBe(1_000_000);
    expect(parts.every((p) => Number.isInteger(p) && p >= 0)).toBe(true);
  });
});

describe('percentOfKzt', () => {
  it('считает процент и округляет до целого тенге', () => {
    expect(percentOfKzt(100_000, 7)).toBe(7000);
    expect(percentOfKzt(100_000, 12.5)).toBe(12500);
    expect(percentOfKzt(333, 10)).toBe(33);
  });
});
