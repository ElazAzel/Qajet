import type { SupabaseClient } from '@supabase/supabase-js';
import { loadBlockedOrders } from './concierge-blocked';
import { formatDate } from './dates';
import { findSilentRfqs, type RfqContactRow, type RfqStatus } from './silent-suppliers';
import { buildRfqReminderText, whatsappChatUrl } from './whatsapp';

/**
 * Обработка исключений — agents.md §10 «Консьерж → Исключения». Состояния
 * `on_hold`/`disputed` существуют в графе с самого начала, но заказ в
 * одном из них виден только на общей доске вперемешку со штатным потоком
 * — здесь тот же список, отфильтрованный и приоритизированный по тому,
 * что требует решения прямо сейчас.
 *
 * Третий вид строки — заказ, по которому отбракованы все КП (аудит F1, F6).
 * Это НЕ состояние заказа, а вывод сравнения, поэтому он выводится запросом,
 * а не фильтром по `state`: заводить ради него новую стадию жизненного цикла
 * значит менять инвариант ради ярлыка на экране.
 *
 * Четвёртый — «поставщик молчит» (`silent-suppliers.ts`): RFQ без ответа перед
 * сроком. Поставщики на старте не следят за сайтом, и до пилотного объёма
 * заказов канал «консьерж связался напрямую» надёжнее любой рассылки.
 */

export type ExceptionKind = 'on_hold' | 'disputed' | 'blocked_quotes' | 'silent_supplier';

export interface ExceptionRow {
  orderId: string;
  requestTitle: string;
  buyerCompany: string;
  kind: ExceptionKind;
  since: string | null;
  note: string | null;
  /** Только у «Поставщик молчит»: кому и как напомнить. */
  reminders?: SupplierReminder[];
}

export interface SupplierReminder {
  supplierName: string;
  /** Ссылка wa.me с готовым текстом; null — номер WhatsApp не указан. */
  whatsappUrl: string | null;
}

export const EXCEPTION_LABEL: Record<ExceptionKind, string> = {
  on_hold: 'На паузе',
  disputed: 'Спор',
  blocked_quotes: 'Все КП отбракованы',
  silent_supplier: 'Поставщик молчит',
};

// Срок, который видит консьерж, обязан совпадать с датой в WhatsApp-напоминании
// поставщику — оба берут календарь Алматы из ./dates.
function formatDeadline(iso: string | null): string {
  return iso ? `срок ${formatDate(iso)}` : 'срок не задан';
}

interface RfqQueryRow {
  id: string;
  request_id: string;
  status: RfqStatus;
  sent_at: string;
  respond_by: string | null;
  companies: CompanyWithProfile | CompanyWithProfile[] | null;
}

interface CompanyWithProfile {
  name: string;
  supplier_profiles: { whatsapp_phone: string | null } | { whatsapp_phone: string | null }[] | null;
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

/** Заказы в «RFQ отправлен», по которым пора звонить поставщикам. */
async function loadSilentSupplierRows(
  supabase: SupabaseClient,
  orders: readonly OrderRow[],
  now: Date,
): Promise<ExceptionRow[]> {
  if (orders.length === 0) return [];
  const { data } = await supabase
    .from('rfqs')
    .select(
      'id, request_id, status, sent_at, respond_by, companies(name, supplier_profiles(whatsapp_phone))',
    )
    .in(
      'request_id',
      orders.map((row) => row.request_id),
    )
    .eq('status', 'sent');
  const phoneByRfq = new Map<string, string | null>();
  const contacts: RfqContactRow[] = ((data ?? []) as unknown as RfqQueryRow[]).map((row) => {
    const company = one(row.companies);
    phoneByRfq.set(row.id, one(company?.supplier_profiles)?.whatsapp_phone ?? null);
    return {
      id: row.id,
      requestId: row.request_id,
      supplierName: company?.name ?? 'поставщик',
      status: row.status,
      sentAt: row.sent_at,
      respondBy: row.respond_by,
    };
  });

  const silentByRequest = new Map<string, RfqContactRow[]>();
  for (const rfq of findSilentRfqs(contacts, now)) {
    silentByRequest.set(rfq.requestId, [...(silentByRequest.get(rfq.requestId) ?? []), rfq]);
  }

  // Ссылка в напоминании должна открываться с телефона поставщика, то есть быть
  // абсолютной. Без NEXT_PUBLIC_SITE_URL (локально) остаётся путь.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ?? '';
  const rows: ExceptionRow[] = [];
  for (const order of orders) {
    const silent = silentByRequest.get(order.request_id);
    if (!silent || silent.length === 0) continue;
    const [first] = silent;
    const names = silent.map((rfq) => rfq.supplierName).join(', ');
    rows.push({
      orderId: order.id,
      ...describe(order),
      kind: 'silent_supplier',
      since: first?.respondBy ?? first?.sentAt ?? null,
      note: `${silent.length === 1 ? 'Не ответил' : 'Не ответили'}: ${names} (${formatDeadline(first?.respondBy ?? null)}). Свяжитесь напрямую.`,
      reminders: silent.map((rfq) => {
        const phone = phoneByRfq.get(rfq.id) ?? null;
        const { requestTitle } = describe(order);
        return {
          supplierName: rfq.supplierName,
          whatsappUrl: phone
            ? whatsappChatUrl(
                phone,
                buildRfqReminderText({
                  requestTitle,
                  respondBy: rfq.respondBy,
                  rfqUrl: `${siteUrl}/supplier/rfq/${rfq.id}`,
                }),
              )
            : null,
        };
      }),
    });
  }
  return rows;
}

interface OrderRow {
  id: string;
  request_id: string;
  state: string;
  updated_at: string;
  requests: { title: string; companies: { name: string } | { name: string }[] | null } | null;
}

function describe(row: OrderRow) {
  const request = Array.isArray(row.requests) ? row.requests[0] : row.requests;
  const company = request
    ? Array.isArray(request.companies)
      ? request.companies[0]
      : request.companies
    : null;
  return { requestTitle: request?.title ?? '—', buyerCompany: company?.name ?? '—' };
}

export async function loadConciergeExceptions(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<ExceptionRow[]> {
  // Один запрос на оба вида: заказы в исключительных состояниях и кандидаты
  // на «все КП отбракованы». Разделение — уже в памяти.
  const { data } = await supabase
    .from('orders')
    .select('id, request_id, state, updated_at, requests(title, companies(name))')
    .in('state', ['on_hold', 'disputed', 'quotes_received', 'rfq_sent'])
    .order('updated_at', { ascending: true });

  const orderRows = (data ?? []) as unknown as OrderRow[];
  if (orderRows.length === 0) return [];

  const silentRows = await loadSilentSupplierRows(
    supabase,
    orderRows.filter((row) => row.state === 'rfq_sent'),
    now,
  );
  const stateRows = orderRows.filter((row) => row.state === 'on_hold' || row.state === 'disputed');
  const blocked = await loadBlockedOrders(
    supabase,
    orderRows
      .filter((row) => row.state === 'quotes_received')
      .map((row) => ({ orderId: row.id, requestId: row.request_id })),
  );

  const shownIds = [...stateRows.map((row) => row.id), ...blocked.keys()];
  if (shownIds.length === 0) return silentRows;

  const { data: eventRows } = await supabase
    .from('order_stage_events')
    .select('order_id, to_state, at, note')
    .in('order_id', shownIds)
    .in('to_state', ['on_hold', 'disputed', 'quotes_received'])
    .order('at', { ascending: false });

  // Последнее событие входа в это положение — момент, с которого заказ ждёт
  // решения. `updated_at` заказа не годится: он двигается и от других правок.
  const latestEventByOrder = new Map<string, { at: string; note: string | null }>();
  for (const event of eventRows ?? []) {
    if (!latestEventByOrder.has(event.order_id)) {
      latestEventByOrder.set(event.order_id, { at: event.at, note: event.note });
    }
  }

  const rows: ExceptionRow[] = [];
  for (const row of orderRows) {
    const blockedHit = blocked.get(row.id);
    if (row.state === 'rfq_sent') continue;
    if (row.state === 'quotes_received' && !blockedHit) continue;

    const event = latestEventByOrder.get(row.id);
    rows.push({
      orderId: row.id,
      ...describe(row),
      kind: blockedHit ? 'blocked_quotes' : (row.state as ExceptionKind),
      since: event?.at ?? row.updated_at,
      note: blockedHit
        ? `Нет ни одного допустимого КП по позиции «${blockedHit.blockingItemName}» — запросите исправление.`
        : (event?.note ?? null),
    });
  }

  return [...rows, ...silentRows].sort((a, b) => (a.since ?? '').localeCompare(b.since ?? ''));
}
