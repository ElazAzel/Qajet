import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireCurrentUser } from '../../../lib/current-user';
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

interface RfqDetailRow {
  id: string;
  status: string;
  respond_by: string | null;
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
      'id, status, respond_by, requests(id, title, deadline_date, companies(name), request_items(id, name, qty, unit, category))',
    )
    .eq('id', id)
    .maybeSingle<RfqDetailRow>();

  if (!data?.requests) notFound();

  const request = data.requests;
  const buyerCompany = Array.isArray(request.companies) ? request.companies[0] : request.companies;
  const items = request.request_items ?? [];
  const alreadyAnswered = data.status !== 'sent';

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
          ` · нужна доставка к ${new Date(request.deadline_date).toLocaleDateString('ru-RU')}`}
      </p>

      {alreadyAnswered ? (
        <div className="mt-6 rounded-card border border-rule bg-surface p-6 text-fine text-muted">
          На этот запрос уже дан ответ ({data.status === 'quoted' ? 'КП отправлено' : 'отказ'}).
        </div>
      ) : (
        <QuoteForm rfqId={data.id} items={items} />
      )}
    </div>
  );
}
