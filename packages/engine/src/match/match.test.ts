import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEIGHTS,
  type ExplorationCandidate,
  isExplorationSlot,
  passesHardFilters,
  pickExplorationCandidate,
  predictSuccessProbability,
  type ScoringFeatures,
  sampleBeta,
  scoreSupplier,
  sgdUpdate,
} from './match.js';

/** Детерминированный PRNG (mulberry32) — статистические тесты не должны быть флаки. */
function seededRng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const baseSupplier = {
  isActive: true,
  isVerified: true,
  isBlocked: false,
  categories: ['merch'],
  capabilities: ['screen-print'],
  minOrderKzt: null,
  servesCities: null,
};

const baseRequest = {
  category: 'merch',
  requiredCapabilities: ['screen-print'],
  orderValueKzt: 500_000,
  city: 'Алматы',
};

describe('passesHardFilters', () => {
  it('пропускает поставщика, удовлетворяющего всем условиям', () => {
    expect(passesHardFilters({ id: 's1', ...baseSupplier }, baseRequest)).toEqual({
      passes: true,
    });
  });

  it('отсекает заблокированного раньше остальных проверок', () => {
    const result = passesHardFilters(
      { id: 's1', ...baseSupplier, isBlocked: true, isActive: false },
      baseRequest,
    );
    expect(result).toEqual({ passes: false, reason: 'blocked' });
  });

  it('отсекает неактивного', () => {
    const result = passesHardFilters({ id: 's1', ...baseSupplier, isActive: false }, baseRequest);
    expect(result).toEqual({ passes: false, reason: 'inactive' });
  });

  it('отсекает неверифицированного', () => {
    const result = passesHardFilters({ id: 's1', ...baseSupplier, isVerified: false }, baseRequest);
    expect(result).toEqual({ passes: false, reason: 'not_verified' });
  });

  it('отсекает по несовпадению категории', () => {
    const result = passesHardFilters(
      { id: 's1', ...baseSupplier, categories: ['printing'] },
      baseRequest,
    );
    expect(result).toEqual({ passes: false, reason: 'category_mismatch' });
  });

  it('отсекает по отсутствующему техпроцессу', () => {
    const result = passesHardFilters({ id: 's1', ...baseSupplier, capabilities: [] }, baseRequest);
    expect(result).toEqual({ passes: false, reason: 'missing_capability' });
  });

  it('отсекает по минимальной партии', () => {
    const result = passesHardFilters(
      { id: 's1', ...baseSupplier, minOrderKzt: 1_000_000 },
      baseRequest,
    );
    expect(result).toEqual({ passes: false, reason: 'below_min_order' });
  });

  it('отсекает по городу доставки', () => {
    const result = passesHardFilters(
      { id: 's1', ...baseSupplier, servesCities: ['Астана'] },
      baseRequest,
    );
    expect(result).toEqual({ passes: false, reason: 'city_not_served' });
  });

  it('сопоставляет города без зависимости от регистра и лишних пробелов', () => {
    const result = passesHardFilters(
      { id: 's1', ...baseSupplier, servesCities: ['  АЛМАТЫ  '] },
      { ...baseRequest, city: ' Алматы ' },
    );
    expect(result).toEqual({ passes: true });
  });
});

describe('scoreSupplier / predictSuccessProbability', () => {
  const strongFeatures: ScoringFeatures = {
    categoryMatch: 1,
    onTimeRate: 1,
    noDisputeRate: 1,
    responseSpeedScore: 1,
    winRate: 1,
    freshnessScore: 1,
    currentLoad: 0,
  };
  const weakFeatures: ScoringFeatures = {
    categoryMatch: 1,
    onTimeRate: 0.2,
    noDisputeRate: 0.5,
    responseSpeedScore: 0.1,
    winRate: 0.1,
    freshnessScore: 0.1,
    currentLoad: 1,
  };

  it('сильный поставщик получает более высокий скор и вероятность, чем слабый', () => {
    expect(scoreSupplier(strongFeatures)).toBeGreaterThan(scoreSupplier(weakFeatures));
    expect(predictSuccessProbability(strongFeatures)).toBeGreaterThan(
      predictSuccessProbability(weakFeatures),
    );
  });

  it('высокая текущая загрузка снижает скор при отрицательном весе', () => {
    const loaded = { ...strongFeatures, currentLoad: 1 };
    expect(scoreSupplier(loaded, DEFAULT_WEIGHTS)).toBeLessThan(scoreSupplier(strongFeatures));
  });
});

describe('sgdUpdate', () => {
  it('после шага в сторону положительного исхода вероятность для тех же признаков растёт', () => {
    const features: ScoringFeatures = {
      categoryMatch: 1,
      onTimeRate: 0.8,
      noDisputeRate: 0.9,
      responseSpeedScore: 0.7,
      winRate: 0.6,
      freshnessScore: 0.5,
      currentLoad: 0.3,
    };
    const before = predictSuccessProbability(features, DEFAULT_WEIGHTS);
    const updated = sgdUpdate(DEFAULT_WEIGHTS, features, 1, 0.5);
    const after = predictSuccessProbability(features, updated);
    expect(after).toBeGreaterThan(before);
  });

  it('после шага в сторону отрицательного исхода вероятность падает', () => {
    const features: ScoringFeatures = {
      categoryMatch: 1,
      onTimeRate: 0.8,
      noDisputeRate: 0.9,
      responseSpeedScore: 0.7,
      winRate: 0.6,
      freshnessScore: 0.5,
      currentLoad: 0.3,
    };
    const before = predictSuccessProbability(features, DEFAULT_WEIGHTS);
    const updated = sgdUpdate(DEFAULT_WEIGHTS, features, 0, 0.5);
    const after = predictSuccessProbability(features, updated);
    expect(after).toBeLessThan(before);
  });
});

describe('sampleBeta', () => {
  it('среднее большой выборки близко к теоретическому a/(a+b)', () => {
    const rng = seededRng(42);
    const samples = Array.from({ length: 5000 }, () => sampleBeta(2, 8, rng));
    const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
    expect(mean).toBeCloseTo(0.2, 1);
  });

  it('значения всегда в диапазоне (0, 1)', () => {
    const rng = seededRng(7);
    for (let i = 0; i < 500; i++) {
      const v = sampleBeta(3, 5, rng);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('pickExplorationCandidate', () => {
  it('поставщик без истории реально может выиграть слот исследования, а не символически', () => {
    const candidates: ExplorationCandidate[] = [
      { id: 'incumbent', successCount: 40, failCount: 5 }, // сильная история, среднее ~0.89
      { id: 'newcomer', successCount: 0, failCount: 0 }, // Beta(1,1) — равномерный априор
    ];
    const rng = seededRng(123);
    let newcomerWins = 0;
    const trials = 2000;
    for (let i = 0; i < trials; i++) {
      if (pickExplorationCandidate(candidates, rng) === 'newcomer') newcomerWins++;
    }
    // Не должен побеждать часто (у incumbent реальная история), но и не ноль —
    // именно высокая дисперсия Beta(1,1) даёт новым поставщикам шанс.
    expect(newcomerWins).toBeGreaterThan(0);
    expect(newcomerWins).toBeLessThan(trials);
  });

  it('пустой список кандидатов — null, а не ошибка', () => {
    expect(pickExplorationCandidate([])).toBeNull();
  });
});

describe('isExplorationSlot', () => {
  it('ровно один слот из каждых N', () => {
    const flags = Array.from({ length: 10 }, (_, i) => isExplorationSlot(i, 5));
    expect(flags.filter(Boolean).length).toBe(2); // индексы 0 и 5
  });

  it('everyN=0 или отрицательное — исследование выключено', () => {
    expect(isExplorationSlot(0, 0)).toBe(false);
    expect(isExplorationSlot(5, -1)).toBe(false);
  });
});
