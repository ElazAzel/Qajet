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

  it('uses configured buffers and tariffs for both route kinds', () => {
    const settings = {
      localBufferDays: 2,
      intercityBufferDays: 7,
      localDeliveryKzt: 8_000,
      intercityDeliveryKzt: 25_000,
    };
    expect(deliveryRoute('Алматы', 'алматы', settings)).toEqual({
      kind: 'local',
      bufferDays: 2,
      deliveryKzt: 8_000,
    });
    expect(deliveryRoute('Караганда', 'Алматы', settings)).toEqual({
      kind: 'intercity',
      bufferDays: 7,
      deliveryKzt: 25_000,
    });
  });

  it('falls back safely for invalid settings', () => {
    expect(
      deliveryRoute('Алматы', 'Алматы', {
        localBufferDays: -1,
        localDeliveryKzt: 1.5,
      }),
    ).toEqual({
      kind: 'local',
      bufferDays: 1,
      deliveryKzt: 5_000,
    });
  });
});
