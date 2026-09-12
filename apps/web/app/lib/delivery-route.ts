export type DeliveryRouteKind = 'local' | 'intercity';

export interface DeliveryRoute {
  kind: DeliveryRouteKind;
  bufferDays: number;
  deliveryKzt: number;
}

const LOCAL_ROUTE: DeliveryRoute = { kind: 'local', bufferDays: 1, deliveryKzt: 5_000 };
const INTERCITY_ROUTE: DeliveryRoute = { kind: 'intercity', bufferDays: 3, deliveryKzt: 15_000 };

function normalizedCity(city: string | null | undefined): string {
  return city?.trim().toLocaleLowerCase('ru-RU') ?? '';
}

export function deliveryRoute(
  supplierCity: string | null | undefined,
  requestCity: string | null | undefined,
): DeliveryRoute {
  const source = normalizedCity(supplierCity);
  const destination = normalizedCity(requestCity);
  return source && destination && source === destination ? LOCAL_ROUTE : INTERCITY_ROUTE;
}
