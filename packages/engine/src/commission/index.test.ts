import { describe, expect, it } from 'vitest';
import {
  COMMISSION_DEFAULT_PCT,
  COMMISSION_MAX_PCT,
  COMMISSION_MIN_PCT,
  isValidCommissionPct,
  suggestCommissionPct,
} from './index.js';

describe('isValidCommissionPct', () => {
  it('принимает границы диапазона', () => {
    expect(isValidCommissionPct(COMMISSION_MIN_PCT)).toBe(true);
    expect(isValidCommissionPct(COMMISSION_MAX_PCT)).toBe(true);
    expect(isValidCommissionPct(COMMISSION_DEFAULT_PCT)).toBe(true);
  });

  it('отклоняет значения вне диапазона', () => {
    expect(isValidCommissionPct(9)).toBe(false);
    expect(isValidCommissionPct(16)).toBe(false);
    expect(isValidCommissionPct(0)).toBe(false);
  });

  it('отклоняет не-конечные значения', () => {
    expect(isValidCommissionPct(Number.NaN)).toBe(false);
    expect(isValidCommissionPct(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('suggestCommissionPct', () => {
  it('ниже порога образцов — null', () => {
    const samples = [
      { category: 'merch', pct: 12 },
      { category: 'merch', pct: 12 },
    ];
    expect(suggestCommissionPct('merch', samples)).toBeNull();
  });

  it('на пороге — усредняет и округляет', () => {
    const samples = [
      { category: 'merch', pct: 10 },
      { category: 'merch', pct: 12 },
      { category: 'merch', pct: 12 },
    ];
    // (10+12+12)/3 = 11.333... -> round -> 11
    expect(suggestCommissionPct('merch', samples)).toEqual({ pct: 11, sampleCount: 3 });
  });

  it('учитывает только совпадающую категорию', () => {
    const samples = [
      { category: 'merch', pct: 15 },
      { category: 'merch', pct: 15 },
      { category: 'merch', pct: 15 },
      { category: 'printing', pct: 10 },
      { category: 'printing', pct: 10 },
    ];
    expect(suggestCommissionPct('merch', samples)).toEqual({ pct: 15, sampleCount: 3 });
    expect(suggestCommissionPct('printing', samples)).toBeNull();
  });

  it('клампит результат усреднения в допустимый диапазон', () => {
    // Гипотетический случай данных вне диапазона (не должен встречаться
    // в реальности — override всегда валидируется isValidCommissionPct
    // перед записью), но функция не должна вернуть значение вне [10,15].
    const samples = [
      { category: 'merch', pct: 30 },
      { category: 'merch', pct: 30 },
      { category: 'merch', pct: 30 },
    ];
    expect(suggestCommissionPct('merch', samples)).toEqual({ pct: 15, sampleCount: 3 });
  });
});
