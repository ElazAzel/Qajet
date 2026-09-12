import { describe, expect, it } from 'vitest';
import { deliveryRoute } from './delivery-route';

describe('deliveryRoute', () => {
  it('uses local delivery for two equal non-empty cities', () => {
    expect(deliveryRoute('Алматы', 'Алматы')).toEqual({
      kind: 'local',
      bufferDays: 1,
      deliveryKzt: 5_000,
    });
  });

  it('uses intercity delivery for different cities', () => {
    expect(deliveryRoute('Караганда', 'Алматы')).toEqual({
      kind: 'intercity',
      bufferDays: 3,
      deliveryKzt: 15_000,
    });
  });

  it('uses the safe intercity default when a city is missing', () => {
    expect(deliveryRoute(null, 'Алматы').kind).toBe('intercity');
    expect(deliveryRoute(' ', null).kind).toBe('intercity');
  });
});
