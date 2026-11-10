/**
 * Параметры экономики и подбора, без которых приложение не считает цену,
 * запас и рассылку RFQ. Общие для демо-сида и для чистого клиентского
 * окружения (`db:provision-clients`): расходиться им незачем, а реквизиты
 * QAJET сюда сознательно не входят — в демо они выдуманные, а в клиентском
 * окружении обязаны быть настоящими.
 */

/** Плейсхолдер до решения по тарифам (agents.md §17: "финальный процент комиссии — параметр, не константа"). */
export const COMMISSION_RATE_PCT = 15;
/** Ставка КПН РК, 2026 (agents.md §11.4). */
export const CIT_RATE_PCT = 20;
/** Стоимость часа закупщика (agents.md §9) — параметр экономики, правится админом вживую. */
export const PROCUREMENT_HOUR_COST_KZT = 4500;
export const LOGISTICS_BUFFER_ALMATY_DAYS = 1;
export const LOGISTICS_BUFFER_INTERCITY_DAYS = 3;
export const LOGISTICS_DELIVERY_LOCAL_KZT = 5_000;
export const LOGISTICS_DELIVERY_INTERCITY_KZT = 15_000;

export const OPERATIONAL_SETTINGS: ReadonlyArray<{ key: string; value: unknown }> = [
  { key: 'commission_rate_pct', value: COMMISSION_RATE_PCT },
  { key: 'commission_base', value: 'supplier_ex_delivery' },
  { key: 'cit_rate_pct', value: CIT_RATE_PCT },
  // Стоимость часа закупщика (agents.md §9) — из неё считается полная
  // стоимость обслуживания заказа и вклад после прямых затрат.
  { key: 'procurement_hour_cost_kzt', value: PROCUREMENT_HOUR_COST_KZT },
  { key: 'logistics_buffer_days_almaty', value: LOGISTICS_BUFFER_ALMATY_DAYS },
  { key: 'logistics_buffer_days_intercity', value: LOGISTICS_BUFFER_INTERCITY_DAYS },
  { key: 'logistics_delivery_kzt_local', value: LOGISTICS_DELIVERY_LOCAL_KZT },
  { key: 'logistics_delivery_kzt_intercity', value: LOGISTICS_DELIVERY_INTERCITY_KZT },
  // Подбор поставщиков под RFQ (agents.md §8C) — apps/web/app/lib/actions/order-actions.ts
  { key: 'rfq_batch_size_per_item', value: 5 },
  { key: 'rfq_exploration_every_n', value: 4 },
];
