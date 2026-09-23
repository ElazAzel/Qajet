/**
 * «Поставщик молчит» — правило эскалации к консьержу.
 *
 * На старте у поставщика мало заказов от QAJET, и следить за сайтом он не будет.
 * Поэтому RFQ без ответа перед сроком — не повод ждать, пока он истечёт, а задача
 * консьержу: связаться напрямую. Правило детерминированное и без запросов, чтобы
 * одно и то же положение давало одну и ту же очередь.
 */

export type RfqStatus = 'sent' | 'quick_responded' | 'quoted' | 'declined' | 'expired';

export interface RfqContactRow {
  id: string;
  requestId: string;
  supplierName: string;
  status: RfqStatus;
  sentAt: string;
  respondBy: string | null;
}

/** За сколько до срока молчание становится задачей консьержа. */
export const SILENCE_BEFORE_DEADLINE_HOURS = 24;
/** Для RFQ без срока — сколько молчания уже слишком много. */
export const SILENCE_WITHOUT_DEADLINE_HOURS = 48;

const HOUR = 3_600_000;

/** Момент, с которого молчание требует звонка. */
function escalateAt(row: RfqContactRow): number {
  if (row.respondBy) return Date.parse(row.respondBy) - SILENCE_BEFORE_DEADLINE_HOURS * HOUR;
  return Date.parse(row.sentAt) + SILENCE_WITHOUT_DEADLINE_HOURS * HOUR;
}

/**
 * RFQ, по которым поставщик не ответил никак (ни «берусь», ни КП, ни отказ) и
 * время эскалации наступило. Самые срочные — первыми.
 */
export function findSilentRfqs(rows: readonly RfqContactRow[], now: Date): RfqContactRow[] {
  return rows
    .filter((row) => row.status === 'sent' && escalateAt(row) <= now.getTime())
    .sort((a, b) => escalateAt(a) - escalateAt(b));
}
