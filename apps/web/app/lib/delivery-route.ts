export type DeliveryRouteKind = 'local' | 'intercity';

export interface DeliveryRoute {
  kind: DeliveryRouteKind;
  bufferDays: number;
  deliveryKzt: number;
}

export interface DeliveryRouteSettings {
  localBufferDays?: number;
  intercityBufferDays?: number;
  localDeliveryKzt?: number;
  intercityDeliveryKzt?: number;
}

export const DEFAULT_DELIVERY_ROUTE_SETTINGS: Required<DeliveryRouteSettings> = {
  localBufferDays: 1,
  intercityBufferDays: 3,
  localDeliveryKzt: 5_000,
  intercityDeliveryKzt: 15_000,
};

function normalizedCity(city: string | null | undefined): string {
  return city?.trim().toLocaleLowerCase('ru-RU') ?? '';
}

export function deliveryRoute(
  supplierCity: string | null | undefined,
  requestCity: string | null | undefined,
  settings: DeliveryRouteSettings = DEFAULT_DELIVERY_ROUTE_SETTINGS,
): DeliveryRoute {
  const source = normalizedCity(supplierCity);
  const destination = normalizedCity(requestCity);
  const local = source && destination && source === destination;
  const fallbackBuffer = local
    ? DEFAULT_DELIVERY_ROUTE_SETTINGS.localBufferDays
    : DEFAULT_DELIVERY_ROUTE_SETTINGS.intercityBufferDays;
  const fallbackCost = local
    ? DEFAULT_DELIVERY_ROUTE_SETTINGS.localDeliveryKzt
    : DEFAULT_DELIVERY_ROUTE_SETTINGS.intercityDeliveryKzt;
  const configuredBuffer = local ? settings.localBufferDays : settings.intercityBufferDays;
  const configuredCost = local ? settings.localDeliveryKzt : settings.intercityDeliveryKzt;
  return {
    kind: local ? 'local' : 'intercity',
    bufferDays:
      typeof configuredBuffer === 'number' &&
      Number.isFinite(configuredBuffer) &&
      configuredBuffer >= 0
        ? configuredBuffer
        : fallbackBuffer,
    deliveryKzt:
      typeof configuredCost === 'number' &&
      Number.isSafeInteger(configuredCost) &&
      configuredCost >= 0
        ? configuredCost
        : fallbackCost,
  };
}
