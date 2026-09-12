import { describe, expect, it } from 'vitest';
import { matcherFeatures } from './supplier-matcher';

describe('matcherFeatures', () => {
  it('uses recent supplier activity and open-order load in the score features', () => {
    const features = matcherFeatures(
      {
        ordersTotal: 8,
        ordersOnTime: 7,
        ordersDisputed: 1,
        rfqSent: 10,
        medianResponseHours: 12,
      },
      { openOrderCount: 3, lastClosedAt: '2026-09-01T00:00:00.000Z' },
      '2026-09-12T00:00:00.000Z',
    );

    expect(features.freshnessScore).toBeCloseTo(1 - 11 / 180);
    expect(features.currentLoad).toBeCloseTo(3 / 5);
    expect(features.onTimeRate).toBeCloseTo(7 / 8);
    expect(features.winRate).toBeCloseTo(0.8);
  });

  it('keeps unknown activity neutral and clamps malformed history safely', () => {
    const features = matcherFeatures(
      {
        ordersTotal: 0,
        ordersOnTime: 20,
        ordersDisputed: -2,
        rfqSent: 0,
        medianResponseHours: null,
      },
      { openOrderCount: -4, lastClosedAt: null },
      '2026-09-12T00:00:00.000Z',
    );

    expect(features.onTimeRate).toBe(0.5);
    expect(features.noDisputeRate).toBe(0.5);
    expect(features.responseSpeedScore).toBe(0.5);
    expect(features.freshnessScore).toBe(0.5);
    expect(features.currentLoad).toBe(0);
  });
});
