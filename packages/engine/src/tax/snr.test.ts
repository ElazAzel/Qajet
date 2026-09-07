import { describe, expect, it } from 'vitest';
import { calculateSnrTaxEffect } from './snr.js';

describe('calculateSnrTaxEffect', () => {
  it('не начисляет эффект для поставщиков на общем режиме', () => {
    const result = calculateSnrTaxEffect(
      [{ supplierTaxMode: 'general', lineCostKzt: 1_000_000 }],
      20,
    );
    expect(result.effectKzt).toBe(0);
    expect(result.affectedCostKzt).toBe(0);
  });

  it('считает эффект только по строкам поставщиков на упрощённой декларации', () => {
    const result = calculateSnrTaxEffect(
      [
        { supplierTaxMode: 'simplified', lineCostKzt: 500_000 },
        { supplierTaxMode: 'general', lineCostKzt: 500_000 },
      ],
      20,
    );
    expect(result.affectedCostKzt).toBe(500_000);
    expect(result.effectKzt).toBe(100_000);
  });

  it('игнорирует retail и unknown как не подпадающие под правило упрощённой декларации', () => {
    const result = calculateSnrTaxEffect(
      [
        { supplierTaxMode: 'retail', lineCostKzt: 300_000 },
        { supplierTaxMode: 'unknown', lineCostKzt: 300_000 },
      ],
      20,
    );
    expect(result.effectKzt).toBe(0);
  });

  it('всегда возвращает дисклеймер про бухгалтера покупателя', () => {
    const result = calculateSnrTaxEffect([], 20);
    expect(result.disclaimer).toMatch(/бухгалтер/);
  });

  it('ключевой сценарий §15: дешёвое КП у СНР-поставщика может стать дороже после эффекта', () => {
    // Оффер A: 900 000 тг у поставщика на упрощённой декларации.
    // Оффер B: 1 000 000 тг у поставщика на общем режиме.
    // При ставке КПН 20% эффект по A = 180 000 — реальная стоимость для
    // покупателя (900 000 + эффект) > 1 000 000, B оказывается выгоднее.
    const effectA = calculateSnrTaxEffect(
      [{ supplierTaxMode: 'simplified', lineCostKzt: 900_000 }],
      20,
    );
    const effectB = calculateSnrTaxEffect(
      [{ supplierTaxMode: 'general', lineCostKzt: 1_000_000 }],
      20,
    );
    const effectiveA = 900_000 + effectA.effectKzt;
    const effectiveB = 1_000_000 + effectB.effectKzt;
    expect(effectiveA).toBeGreaterThan(effectiveB);
  });
});
