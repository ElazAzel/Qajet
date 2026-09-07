import { describe, expect, it } from 'vitest';
import {
  calculateSlackDays,
  calculateSupplierReliability,
  predictAfterQuote,
  predictBeforeQuote,
} from './predict.js';

describe('predictBeforeQuote', () => {
  it('медиана фактических сроков по категории', () => {
    expect(predictBeforeQuote([5, 7, 9])).toBe(7);
    expect(predictBeforeQuote([5, 10])).toBe(7.5);
    expect(predictBeforeQuote([])).toBe(0);
  });
});

describe('calculateSupplierReliability', () => {
  it('без истории k сдвигается ровно к 1.0', () => {
    const r = calculateSupplierReliability([]);
    expect(r.nSamples).toBe(0);
    expect(r.kShrunk).toBe(1.0);
  });

  it('с историей k — медиана факт/заявлено, сдвинутая к 1.0', () => {
    // Поставщик системно опаздывает на 50%: факт всегда в 1.5 раза больше заявленного.
    const history = [
      { declaredDays: 10, actualDays: 15 },
      { declaredDays: 10, actualDays: 15 },
      { declaredDays: 10, actualDays: 15 },
    ];
    const r = calculateSupplierReliability(history);
    expect(r.k).toBe(1.5);
    // k' = (3*1.5 + 3*1.0) / 6 = 1.25 — сдвинуто к 1.0, но не до конца.
    expect(r.kShrunk).toBeCloseTo(1.25, 5);
  });

  it('с ростом N сдвиг к 1.0 ослабевает — k приближается к сырой медиане', () => {
    const history = Array.from({ length: 50 }, () => ({ declaredDays: 10, actualDays: 15 }));
    const r = calculateSupplierReliability(history);
    expect(r.kShrunk).toBeGreaterThan(1.4);
    expect(r.kShrunk).toBeLessThan(1.5);
  });

  it('игнорирует записи с нулевым заявленным сроком', () => {
    const r = calculateSupplierReliability([{ declaredDays: 0, actualDays: 5 }]);
    expect(r.nSamples).toBe(0);
  });
});

describe('predictAfterQuote', () => {
  it('прогноз = заявленный срок × k поставщика + буфер логистики', () => {
    const result = predictAfterQuote({
      declaredLeadDays: 10,
      supplierHistory: [
        { declaredDays: 10, actualDays: 15 },
        { declaredDays: 10, actualDays: 15 },
        { declaredDays: 10, actualDays: 15 },
      ],
      logisticsBufferDays: 1,
    });
    // declared(10) * kShrunk(1.25) + буфер(1) = 13.5
    expect(result.predictedDays).toBeCloseTo(13.5, 5);
  });

  it('новый поставщик без истории — прогноз это просто заявленный срок + буфер', () => {
    const result = predictAfterQuote({
      declaredLeadDays: 7,
      supplierHistory: [],
      logisticsBufferDays: 1,
    });
    expect(result.predictedDays).toBe(8);
  });
});

describe('calculateSlackDays', () => {
  it('положительный запас, когда прогноз укладывается раньше дедлайна', () => {
    const start = new Date('2026-09-01T00:00:00Z');
    const deadline = new Date('2026-09-15T00:00:00Z');
    expect(calculateSlackDays(start, 10, deadline)).toBe(4);
  });

  it('отрицательный запас, когда прогноз позже дедлайна', () => {
    const start = new Date('2026-09-01T00:00:00Z');
    const deadline = new Date('2026-09-05T00:00:00Z');
    expect(calculateSlackDays(start, 10, deadline)).toBe(-6);
  });
});
