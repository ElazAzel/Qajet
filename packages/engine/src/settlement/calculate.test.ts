import { describe, expect, it } from 'vitest';
import { calculateSettlement } from './calculate.js';

describe('calculateSettlement', () => {
  it('returns a refund when net receipts exceed the final agreed price', () => {
    expect(calculateSettlement(100_000, 120_000)).toEqual({
      kind: 'refund',
      amountKzt: 20_000,
    });
  });

  it('returns a surcharge when net receipts are below the final agreed price', () => {
    expect(calculateSettlement(100_000, 80_000)).toEqual({
      kind: 'surcharge',
      amountKzt: 20_000,
    });
  });

  it('returns exact when the two amounts match', () => {
    expect(calculateSettlement(100_000, 100_000)).toEqual({
      kind: 'exact',
      amountKzt: 0,
    });
  });

  it('rejects negative or unsafe financial facts', () => {
    expect(() => calculateSettlement(-1, 1)).toThrow();
    expect(() => calculateSettlement(1, -1)).toThrow();
    expect(() => calculateSettlement(Number.MAX_SAFE_INTEGER + 1, 1)).toThrow();
  });
});
