import { Card, formatKzt } from '@qajet/ui/primitives';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { orderActorFor, requireCurrentUser } from '../../../../lib/current-user';
import { RequestQuoteRevision } from './_request-revision';

type Nested<T> = T | T[] | null | undefined;

interface QuoteLineRow {
  request_item_id: string;
  unit_price_kzt: number;
  lead_time_days: number;
  setup_fee_kzt: number;
  min_qty: number | null;
  capability_confirmed: boolean;
  field_flags: Record<string, unknown>;
  request_items: Nested<{ name: string }>;
}

interface QuoteRow {
  id: string;
  version: number;
  submitted_at: string;
  revision_reason: string | null;
  submitted_by: string | null;
  quote_lines: QuoteLineRow[];
}

interface RfqRow {
  id: string;
  status: string;
  revision_requested: boolean;
  revision_note: string | null;
  sent_at: string;
  respond_by: string | null;
  companies: Nested<{ name: string }>;
  quotes: QuoteRow[];
}

interface OrderRow {
  id: string;
  request_id: string;
  requests: Nested<{ title: string }>;
}

export default async function ConciergeQuotesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireCurrentUser();
  const actor = orderActorFor(user);
  if (actor !== 'concierge' && actor !== 'admin') notFound();

  const supabase = await createSupabaseServerClient();
  const { data: order } = await supabase
    .from('orders')
    .select('id, request_id, requests(title)')
    .eq('id', id)
    .maybeSingle<OrderRow>();
  if (!order) notFound();

  const { data: rfqRows } = await supabase
    .from('rfqs')
    .select(
      'id, status, revision_requested, revision_note, sent_at, respond_by, companies(name), quotes(id, version, submitted_at, revision_reason, submitted_by, quote_lines(request_item_id, unit_price_kzt, lead_time_days, setup_fee_kzt, min_qty, capability_confirmed, field_flags, request_items(name)))',
    )
    .eq('request_id', order.request_id)
    .order('sent_at', { ascending: true });
  const rfqs = (rfqRows ?? []) as unknown as RfqRow[];
  const title = unwrap(order.requests)?.title ?? 'Заказ';

  return (
    <div className="max-w-4xl">
      <p className="text-fine text-muted">
        <Link href={`/concierge/orders/${order.id}`} className="hover:text-ink">
          Заказ
        </Link>
        <span className="mx-1.5">›</span>
        КП поставщиков
      </p>
      <h1 className="mt-2 text-2xl font-extrabold text-ink">КП · {title}</h1>
      <p className="mt-1 text-sm text-muted">
        Версии не удаляются. Если данные неполные или неоднозначные, запросите исправление — новая
        версия появится рядом со старой и снова попадёт в сравнение только после проверки.
      </p>

      {rfqs.length === 0 ? (
        <Card className="mt-6" padding="sm">
          <p className="text-sm font-semibold text-ink">RFQ пока не отправлены</p>
          <p className="mt-1 text-fine text-muted">Подбор поставщиков ещё не начат.</p>
        </Card>
      ) : (
        <div className="mt-6 flex flex-col gap-4">
          {rfqs.map((rfq) => {
            const company = unwrap(rfq.companies)?.name ?? 'Поставщик';
            const quotes = [...(rfq.quotes ?? [])].sort((a, b) => b.version - a.version);
            return (
              <Card key={rfq.id} padding="sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-ink">{company}</p>
                    <p className="mt-1 text-fine text-muted">
                      RFQ: {rfq.status === 'quoted' ? 'КП получено' : rfq.status}
                      {rfq.respond_by
                        ? ` · ответ до ${new Date(rfq.respond_by).toLocaleDateString('ru-RU')}`
                        : ''}
                    </p>
                  </div>
                  <span className="rounded-control bg-page px-2.5 py-1 text-micro font-semibold text-muted">
                    {quotes.length} {quotes.length === 1 ? 'версия' : 'версии'}
                  </span>
                </div>

                {quotes.length === 0 ? (
                  <p className="mt-4 text-fine text-muted">КП ещё не сохранено.</p>
                ) : (
                  <div className="mt-4 flex flex-col gap-3">
                    {quotes.map((quote) => (
                      <div
                        key={quote.id}
                        className="rounded-card-sm border border-rule bg-page p-3"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="text-fine font-semibold text-ink">Версия {quote.version}</p>
                          <p className="text-micro text-muted">
                            {new Date(quote.submitted_at).toLocaleString('ru-RU')}
                          </p>
                        </div>
                        {quote.revision_reason && (
                          <p className="mt-1 text-fine text-signal">
                            Причина новой версии: {quote.revision_reason}
                          </p>
                        )}
                        <ul className="mt-3 flex flex-col gap-1.5">
                          {quote.quote_lines.map((line) => {
                            const item = unwrap(line.request_items);
                            const flags = Object.keys(line.field_flags ?? {});
                            return (
                              <li
                                key={`${quote.id}-${line.request_item_id}`}
                                className="flex flex-wrap items-baseline justify-between gap-2 border-rule border-t pt-1.5 text-fine first:border-t-0 first:pt-0"
                              >
                                <span className="text-ink">
                                  {item?.name ?? line.request_item_id}
                                </span>
                                <span className="numeric text-muted">
                                  {formatKzt(line.unit_price_kzt)} / ед. · {line.lead_time_days} дн.
                                  {line.setup_fee_kzt > 0
                                    ? ` · setup ${formatKzt(line.setup_fee_kzt)}`
                                    : ''}
                                  {flags.length > 0 ? ` · уточнить: ${flags.join(', ')}` : ''}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}

                {rfq.revision_requested ? (
                  <p className="mt-4 rounded-control bg-signal/10 px-3 py-2 text-fine text-signal">
                    Запрос исправления уже отправлен: {rfq.revision_note}
                  </p>
                ) : rfq.status === 'quoted' ? (
                  <RequestQuoteRevision rfqId={rfq.id} />
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function unwrap<T>(value: Nested<T>): T | undefined {
  return Array.isArray(value) ? value[0] : (value ?? undefined);
}
