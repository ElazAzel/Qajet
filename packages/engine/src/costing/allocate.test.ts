import { describe, expect, it } from 'vitest';
import { allocateCommission, allocateSupplierCosts } from './allocate.js';

describe('allocateSupplierCosts', () => {
  it('charges setup once per supplier and reconciles line totals with the supplier subtotal', () => {
    const result = allocateSupplierCosts([
      {
        requestItemId: 'item-a',
        offerId: 'offer-a',
        supplierId: 'supplier-a',
        qty: 3,
        productNetKzt: 3_000,
        setupFeeKzt: 2_000,
      },
      {
        requestItemId: 'item-b',
        offerId: 'offer-b',
        supplierId: 'supplier-a',
        qty: 7,
        productNetKzt: 7_000,
        setupFeeKzt: 2_000,
      },
    ]);

    expect(result.setupFeeKzt).toBe(2_000);
    expect(result.totalSupplierKzt).toBe(12_000);
    expect(result.lines.map((line) => line.lineTotalKzt)).toEqual([3_600, 8_400]);
    expect(result.lines.reduce((sum, line) => sum + line.lineTotalKzt, 0)).toBe(
      result.totalSupplierKzt,
    );
  });

  it('keeps separate suppliers separate and allocates each setup once', () => {
    const result = allocateSupplierCosts([
      {
        requestItemId: 'item-a',
        offerId: 'offer-a',
        supplierId: 'supplier-a',
        qty: 10,
        productNetKzt: 10_000,
        setupFeeKzt: 500,
      },
      {
        requestItemId: 'item-b',
        offerId: 'offer-b',
        supplierId: 'supplier-b',
        qty: 9,
        productNetKzt: 9_000,
        setupFeeKzt: 700,
      },
    ]);

    expect(result.setupFeeKzt).toBe(1_200);
    expect(result.totalSupplierKzt).toBe(20_200);
    expect(result.lines.map((line) => line.lineTotalKzt)).toEqual([10_500, 9_700]);
  });
});

describe('allocateCommission', () => {
  it('allocates the rounded aggregate commission without losing a tenge', () => {
    const result = allocateCommission(12_000, 23, [3_600, 8_400]);

    expect(result).toEqual([828, 1_932]);
    expect(result.reduce((sum, value) => sum + value, 0)).toBe(2_760);
  });

  it('uses a deterministic first-line fallback for a zero base', () => {
    expect(allocateCommission(0, 23, [0, 0])).toEqual([0, 0]);
  });
});
