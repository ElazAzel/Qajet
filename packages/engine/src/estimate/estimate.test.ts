import { describe, expect, it } from 'vitest';
import { estimate } from './estimate.js';

describe('estimate', () => {
  it('без истории оценка — чистая стартовая ставка, запас стартовый 25%', () => {
    const result = estimate({ qty: 100, observations: [], baseRateKzt: 500 });
    expect(result.p50Kzt).toBe(50_000);
    expect(result.marginPct).toBe(0.25);
    expect(result.p80Kzt).toBe(62_500);
    expect(result.basis.nSamples).toBe(0);
    expect(result.basis.shareFromHistory).toBe(0);
  });

  it('с одной уникальной qty регрессия не строится — эффект тиража не сработает на одной точке', () => {
    const result = estimate({
      qty: 50,
      observations: [
        { qty: 20, unitPriceKzt: 900 },
        { qty: 20, unitPriceKzt: 950 },
      ],
      baseRateKzt: 1000,
    });
    expect(result.basis.shareFromHistory).toBe(0);
    expect(result.p50Kzt).toBe(50_000); // чистая базовая ставка: 1000 * 50
  });

  it('модель тиража смешивается с базовой ставкой по λ = N/(N+8)', () => {
    // Две точки задают регрессию точно: qty=10→1000, qty=1000→100 (цена падает с тиражом).
    const result = estimate({
      qty: 10,
      observations: [
        { qty: 10, unitPriceKzt: 1000 },
        { qty: 1000, unitPriceKzt: 100 },
      ],
      baseRateKzt: 500,
    });
    // λ = 2/(2+8) = 0.2. Модель на qty=10 точно возвращает 1000 (точка регрессии).
    // blended = 0.2*1000 + 0.8*500 = 600 → p50 = 600*10 = 6000.
    expect(result.basis.shareFromHistory).toBeCloseTo(0.2, 10);
    expect(result.p50Kzt).toBe(6000);
  });

  it('λ растёт к 1 с ростом числа наблюдений — модель тиража всё сильнее вытесняет базовую ставку', () => {
    const points = Array.from({ length: 40 }, (_, i) => ({
      qty: 10 + i,
      unitPriceKzt: 1000 - i * 5,
    }));
    const result = estimate({ qty: 30, observations: points, baseRateKzt: 10_000 });
    expect(result.basis.shareFromHistory).toBeGreaterThan(0.8);
  });

  it('запас — P80-квантиль прошлых относительных ошибок, а не константа', () => {
    const errors = [-0.1, 0.05, 0.1, 0.15, 0.2, 0.3, 0.35, 0.4, 0.5, 0.6];
    const result = estimate({
      qty: 10,
      observations: [],
      baseRateKzt: 1000,
      pastRelativeErrors: errors,
    });
    // P80 такого набора — не магическое число 25%, а посчитанный квантиль.
    expect(result.marginPct).not.toBe(0.25);
    expect(result.marginPct).toBeGreaterThan(0.4);
  });

  it('запас не уходит в ноль/отрицательное, даже если система стабильно переоценивает', () => {
    const errors = [-0.5, -0.4, -0.3, -0.2, -0.1];
    const result = estimate({
      qty: 10,
      observations: [],
      baseRateKzt: 1000,
      pastRelativeErrors: errors,
    });
    expect(result.marginPct).toBeGreaterThanOrEqual(0.05);
  });

  it('basis сохраняет дату последнего наблюдения как есть', () => {
    const result = estimate({
      qty: 5,
      observations: [],
      baseRateKzt: 100,
      lastObservedAt: '2026-08-01',
    });
    expect(result.basis.lastObservedAt).toBe('2026-08-01');
  });
});
