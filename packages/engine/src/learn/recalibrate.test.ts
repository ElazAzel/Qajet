import { describe, expect, it } from 'vitest';
import { DEFAULT_WEIGHTS, type ScoringFeatures } from '../match/match.js';
import {
  recalibrate,
  recalibrateEstimators,
  recalibrateLeadTimes,
  recalibrateMatchWeights,
  recalibrateSupplierStats,
} from './recalibrate.js';

describe('recalibrateEstimators', () => {
  it('запас снижается по мере накопления истории — не магическая константа', () => {
    const early = recalibrateEstimators([
      { category: 'merch', observations: [], relativeErrors: [0.1, 0.2] },
    ])[0];
    const mature = recalibrateEstimators([
      {
        category: 'merch',
        observations: [],
        relativeErrors: Array.from({ length: 100 }, () => 0.05), // стабильно маленькая ошибка
      },
    ])[0];
    expect(early?.marginPct).toBeCloseTo(0.18, 5); // P80 линейной интерполяцией [0.1, 0.2]
    expect(mature?.marginPct).toBeCloseTo(0.05, 5); // упёрлось в пол MIN_MARGIN_PCT
    expect(mature?.marginPct).toBeLessThan(early?.marginPct ?? 0);
    expect(mature?.marginPct).toBeLessThan(0.25);
    expect(mature?.nSamples).toBe(100);
  });

  it('без истории — стартовый запас 25%, регрессия не строится', () => {
    const result = recalibrateEstimators([
      { category: 'new-category', observations: [], relativeErrors: [] },
    ])[0];
    expect(result?.marginPct).toBe(0.25);
    expect(result?.regression).toBeNull();
    expect(Number.isNaN(result?.mape)).toBe(true);
  });

  it('пересчитывает коэффициенты регрессии по точкам категории', () => {
    const result = recalibrateEstimators([
      {
        category: 'merch',
        observations: [
          { qty: 10, unitPriceKzt: 1000 },
          { qty: 1000, unitPriceKzt: 100 },
        ],
        relativeErrors: [],
      },
    ])[0];
    expect(result?.regression).not.toBeNull();
    expect(result?.regression?.b).toBeLessThan(0); // цена падает с тиражом
  });

  it('MAPE — среднее абсолютных относительных ошибок', () => {
    const result = recalibrateEstimators([
      { category: 'merch', observations: [], relativeErrors: [0.1, -0.3, 0.2] },
    ])[0];
    expect(result?.mape).toBeCloseTo(0.2, 5);
  });
});

describe('recalibrateMatchWeights', () => {
  it('пересчитывает веса батчем исходов начиная со стартовых', () => {
    const features: ScoringFeatures = {
      categoryMatch: 1,
      onTimeRate: 0.9,
      noDisputeRate: 0.9,
      responseSpeedScore: 0.8,
      winRate: 0.7,
      freshnessScore: 0.5,
      currentLoad: 0.2,
    };
    const outcomes = Array.from({ length: 20 }, () => ({ features, target: 1 as const }));
    const result = recalibrateMatchWeights(outcomes);
    expect(result.nSamples).toBe(20);
    // После 20 положительных исходов вес категорийного соответствия должен вырасти.
    expect(result.weights.categoryMatch).toBeGreaterThan(DEFAULT_WEIGHTS.categoryMatch);
  });

  it('без исходов веса не меняются', () => {
    const result = recalibrateMatchWeights([]);
    expect(result.weights).toEqual(DEFAULT_WEIGHTS);
    expect(result.nSamples).toBe(0);
  });
});

describe('recalibrateLeadTimes', () => {
  it('пересчитывает k по каждому поставщику независимо', () => {
    const result = recalibrateLeadTimes([
      {
        supplierId: 's1',
        history: [
          { declaredDays: 10, actualDays: 10 },
          { declaredDays: 10, actualDays: 10 },
          { declaredDays: 10, actualDays: 10 },
        ],
      },
      { supplierId: 's2', history: [] },
    ]);
    expect(result.find((r) => r.supplierId === 's1')?.reliability.k).toBe(1);
    expect(result.find((r) => r.supplierId === 's2')?.reliability.nSamples).toBe(0);
  });
});

describe('recalibrateSupplierStats', () => {
  it('три отдельных числа + N, без сводного балла', () => {
    const result = recalibrateSupplierStats([
      { wasOnTime: true, hadDispute: false, buyerScore: 5 },
      { wasOnTime: true, hadDispute: false, buyerScore: 4 },
      { wasOnTime: false, hadDispute: true, buyerScore: null },
    ]);
    expect(result.ordersTotal).toBe(3);
    expect(result.onTimeRate).toBeCloseTo(2 / 3, 5);
    expect(result.noDisputeRate).toBeCloseTo(2 / 3, 5);
    expect(result.avgBuyerScore).toBeCloseTo(4.5, 5);
  });

  it('без заказов — нулевые ставки, без деления на ноль', () => {
    const result = recalibrateSupplierStats([]);
    expect(result).toEqual({
      ordersTotal: 0,
      onTimeRate: 0,
      noDisputeRate: 0,
      avgBuyerScore: null,
    });
  });
});

describe('recalibrate — полный прогон', () => {
  it('собирает снимок по всем моделям сразу, с датой прогона', () => {
    const result = recalibrate({
      estimatorHistories: [{ category: 'merch', observations: [], relativeErrors: [0.1] }],
      matchOutcomes: [],
      leadTimeSuppliers: [{ supplierId: 's1', history: [] }],
      supplierOutcomes: new Map([['s1', [{ wasOnTime: true, hadDispute: false, buyerScore: 5 }]]]),
      now: '2026-09-07T00:00:00Z',
    });
    expect(result.recalibratedAt).toBe('2026-09-07T00:00:00Z');
    expect(result.estimators).toHaveLength(1);
    expect(result.leadTimes).toHaveLength(1);
    expect(result.supplierStats.get('s1')?.ordersTotal).toBe(1);
  });
});
