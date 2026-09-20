import { DEFAULT_WEIGHTS, type MatchWeights } from '@qajet/engine/match';
import { describe, expect, it } from 'vitest';
import { MIN_CLOSED_ORDERS_BEFORE_LEARNED_WEIGHTS, weightsForDispatch } from './match-weights';

/**
 * Контур обучения подбора работает по-настоящему: при закрытии заказа веса
 * пересчитываются и сохраняются снапшотом, а рассылка RFQ читает последний.
 * Порога по количеству наблюдений не было.
 *
 * Почему это опасно именно здесь. Один закрытый заказ даёт наблюдение на
 * КАЖДЫЙ разосланный RFQ — обычно 10–15, — и побеждают из них один-два.
 * Остальные получают цель 0. То есть подавляющее большинство шагов тянет веса
 * вниз, и за несколько заказов модель уезжает в сторону «никто не выигрывает».
 * Это ухудшает ранжирование, а не улучшает.
 *
 * Решение не «выключить обучение», а разделить запись и применение: снапшоты
 * пишутся всегда, применяются только когда наблюдений достаточно.
 */

const learned: MatchWeights = {
  categoryMatch: 9,
  onTimeRate: -9,
  noDisputeRate: 9,
  responseSpeedScore: -9,
  winRate: 9,
  freshnessScore: -9,
  currentLoad: 9,
};

describe('weightsForDispatch', () => {
  it('до порога берёт стартовые веса, даже когда обученные есть', () => {
    const result = weightsForDispatch(learned, MIN_CLOSED_ORDERS_BEFORE_LEARNED_WEIGHTS - 1);
    expect(result.weights).toEqual(DEFAULT_WEIGHTS);
    expect(result.learned, 'признак честно говорит, что обучение не применено').toBe(false);
  });

  it('на пороге начинает применять обученные', () => {
    const result = weightsForDispatch(learned, MIN_CLOSED_ORDERS_BEFORE_LEARNED_WEIGHTS);
    expect(result.weights).toEqual(learned);
    expect(result.learned).toBe(true);
  });

  it('без снапшота всегда стартовые, сколько бы заказов ни было', () => {
    const result = weightsForDispatch(null, 1000);
    expect(result.weights).toEqual(DEFAULT_WEIGHTS);
    expect(result.learned).toBe(false);
  });

  it('первый заказ не сдвигает подбор', () => {
    // Раньше именно здесь один заказ начинал влиять на все следующие рассылки.
    expect(weightsForDispatch(learned, 1).weights).toEqual(DEFAULT_WEIGHTS);
  });

  it('испорченный снапшот не ломает рассылку и не применяется', () => {
    // Снапшот — JSON из базы: его форма не гарантирована типом.
    const broken = { categoryMatch: 1 } as unknown as MatchWeights;
    const result = weightsForDispatch(broken, 1000);
    expect(result.weights).toEqual(DEFAULT_WEIGHTS);
    expect(result.learned).toBe(false);
  });

  it('нечисловое значение в снапшоте отвергается', () => {
    const broken = { ...learned, winRate: 'много' } as unknown as MatchWeights;
    expect(weightsForDispatch(broken, 1000).weights).toEqual(DEFAULT_WEIGHTS);
  });

  it('порог выражен в закрытых заказах, а не в строках наблюдений', () => {
    // Читаемость важна: «30 заказов» проверяемо глазами, «360 наблюдений» — нет.
    expect(MIN_CLOSED_ORDERS_BEFORE_LEARNED_WEIGHTS).toBeGreaterThanOrEqual(10);
    expect(MIN_CLOSED_ORDERS_BEFORE_LEARNED_WEIGHTS).toBeLessThanOrEqual(100);
  });
});
