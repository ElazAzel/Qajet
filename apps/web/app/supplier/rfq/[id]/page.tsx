import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireCurrentUser } from '../../../lib/current-user';
import { formatDate, NUMERIC_DATE } from '../../../lib/dates';
import { pickLatestQuoteByRfq } from '../../../lib/latest-quote';
import { QuoteForm } from './_quote-form';

/**
 * Форма ответа на RFQ, шаг 2 — agents.md §10: цена/срок/setup fee по каждой
 * позиции заявки. RFQ хранится на уровне заявки целиком (rfqs.request_id),
 * не по позициям — поэтому здесь показываются все request_items заявки,
 * supplier сам решает, по каким дать цену.
 */

interface RequestItemRow {
  id: string;
  name: string;
  qty: number;
  unit: string;
  category: string;
}

interface QuoteRow {
  id: string;
  version: number;
  submitted_at: string;
  quote_lines: { request_item_id: string; capability_confirmed: boolean }[] | null;
}

interface RfqDetailRow {
  id: string;
  status: string;
  respond_by: string | null;
  revision_requested: boolean;
  revision_note: string | null;
  quotes: QuoteRow[] | null;
  requests: {
    id: string;
    title: string;
    deadline_date: string | null;
    companies: { name: string } | { name: string }[] | null;
    request_items: RequestItemRow[];
  } | null;
}

export default async function SupplierRfqPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireCurrentUser();
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from('rfqs')
    .select(
      'id, status, respond_by, revision_requested, revision_note, quotes(id, version, submitted_at, quote_lines(request_item_id, capability_confirmed)), requests(id, title, deadline_date, companies(name), request_items(id, name, qty, unit, category))',
    )
    .eq('id', id)
    .maybeSingle<RfqDetailRow>();

  if (!data?.requests) notFound();

  const request = data.requests;
  const buyerCompany = Array.isArray(request.companies) ? request.companies[0] : request.companies;
  const items = request.request_items ?? [];
  const revisionRequested = data.status === 'quoted' && data.revision_requested;
  const alreadyAnswered = !['sent', 'quick_responded'].includes(data.status) && !revisionRequested;

  // Сколько позиций в АКТУАЛЬНОЙ версии КП осталось без подтверждения возможности.
  // Такие позиции не участвуют в сравнении, и раньше поставщик об этом не узнавал
  // ниоткуда (аудит F1).
  const latestQuote = pickLatestQuoteByRfq(
    (data.quotes ?? []).map((quote) => ({ ...quote, rfq_id: data.id })),
  ).get(data.id);
  const unconfirmedCount = (latestQuote?.quote_lines ?? []).filter(
    (line) => line.capability_confirmed === false,
  ).length;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <p className="mb-4 text-fine text-muted">
        <Link href="/supplier" className="hover:text-ink">
          Главная
        </Link>
        <span className="mx-1.5">›</span>
        <span className="font-medium text-ink">Ответ на RFQ</span>
      </p>

      <h1 className="text-2xl font-extrabold">{request.title}</h1>
      <p className="mt-1.5 text-fine text-muted">
        {buyerCompany?.name ?? '—'}
        {request.deadline_date &&
          ` · нужна доставка к ${formatDate(request.deadline_date, NUMERIC_DATE)}`}
      </p>

      {alreadyAnswered ? (
        <>
          <div className="mt-6 rounded-card border border-rule bg-surface p-6 text-fine text-muted">
            На этот запрос уже дан ответ ({data.status === 'quoted' ? 'КП отправлено' : 'отказ'}).
          </div>
          {unconfirmedCount > 0 && (
            <div className="mt-3 rounded-card border border-signal/40 bg-signal/10 p-4 text-fine text-ink">
              <p className="font-semibold">Ждёт вашего подтверждения</p>
              <p className="mt-1 text-muted">
                По {unconfirmedCount} {unconfirmedCount === 1 ? 'позиции' : 'позициям'} не отмечено
                «могу исполнить» — они не участвуют в сравнении.
              </p>
              {/* Честно о том, чего поставщик сделать НЕ может: повторная отправка
                  открывается только запросом исправления от QAJET
                  (submit_supplier_quote принимает КП при revision_requested). */}
              <p className="mt-2 text-muted">
                Отправить новую версию можно после того, как QAJET запросит исправление — тогда эта
                страница снова откроется для заполнения.
              </p>
            </div>
          )}
        </>
      ) : (
        <>
          {revisionRequested && (
            <div className="mt-6 rounded-card border border-signal/40 bg-signal/10 p-4 text-fine text-ink">
              <p className="font-semibold">QAJET запросил исправление КП</p>
              <p className="mt-1 text-muted">{data.revision_note}</p>
              <p className="mt-2 text-muted">
                Предыдущая версия сохранена в истории. Отправьте новую версию целиком или только
                позиции, по которым есть уточнение.
              </p>
            </div>
          )}
          <QuoteForm rfqId={data.id} items={items} revision={revisionRequested} />
        </>
      )}
    </div>
  );
}
