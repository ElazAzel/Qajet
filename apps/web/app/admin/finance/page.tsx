import { Reveal, Stagger, Stamp } from '@qajet/ui/motion';
import { Card, formatKzt, StatTile } from '@qajet/ui/primitives';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireActor } from '../../lib/current-user';

type PaymentFactRow = {
  id: string;
  order_id: string;
  supplier_company_id: string | null;
  direction: string;
  kind: string;
  status: string;
  amount_kzt: number;
  reference: string | null;
  occurred_at: string;
  confirmed_by: string | null;
  orders:
    | { requests: { title: string } | { title: string }[] | null }
    | { requests: { title: string } | { title: string }[] | null }[]
    | null;
  companies: { name: string } | { name: string }[] | null;
};

const KIND_LABEL: Record<string, string> = {
  prepayment: 'Предоплата',
  surcharge: 'Доплата',
  refund: 'Возврат',
  supplier_payout: 'Выплата поставщику',
};

const STATUS_TONE: Record<string, 'success' | 'pending' | 'neutral'> = {
  confirmed: 'success',
  pending: 'pending',
  void: 'neutral',
};

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('ru-RU', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
}

function relatedTitle(row: PaymentFactRow): string {
  const order = Array.isArray(row.orders) ? row.orders[0] : row.orders;
  const request = order
    ? Array.isArray(order.requests)
      ? order.requests[0]
      : order.requests
    : null;
  return request?.title ?? row.order_id.slice(0, 8);
}

function companyName(row: PaymentFactRow): string {
  const company = Array.isArray(row.companies) ? row.companies[0] : row.companies;
  return company?.name ?? '—';
}

export default async function AdminFinancePage() {
  await requireActor('admin');
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('payment_facts')
    .select(
      'id, order_id, supplier_company_id, direction, kind, status, amount_kzt, reference, occurred_at, confirmed_by, orders(requests(title)), companies(name)',
    )
    .order('occurred_at', { ascending: false })
    .limit(100);
  const rows = (data ?? []) as PaymentFactRow[];
  const confirmedInbound = rows
    .filter((row) => row.direction === 'inbound' && row.status === 'confirmed')
    .reduce((sum, row) => sum + row.amount_kzt, 0);
  const confirmedOutbound = rows
    .filter((row) => row.direction === 'outbound' && row.status === 'confirmed')
    .reduce((sum, row) => sum + row.amount_kzt, 0);
  const pendingCount = rows.filter((row) => row.status === 'pending').length;

  return (
    <div className="flex flex-col gap-6">
      <Reveal>
        <h1 className="text-2xl font-extrabold text-ink">Финансовые факты</h1>
        <p className="mt-1.5 text-sm text-muted">
          Аудируемый журнал подтверждений. Статус заказа сам по себе не считается доказательством
          оплаты.
        </p>
      </Reveal>

      <Stagger startIndex={1} as="div" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile
          title="Подтверждено от покупателей"
          value={formatKzt(confirmedInbound)}
          note="Предоплаты и доплаты в видимом окне"
        />
        <StatTile
          title="Подтверждено поставщикам"
          value={formatKzt(confirmedOutbound)}
          note="Выплаты и возвраты в видимом окне"
        />
        <StatTile
          title="Ожидают подтверждения"
          value={String(pendingCount)}
          note="Не участвуют в разрешении стадии"
        />
      </Stagger>

      <Reveal delay={0.12}>
        <Card>
          {error ? (
            <p className="text-fine text-danger">
              Журнал недоступен. Примените миграции базы данных, включая payment_facts.
            </p>
          ) : rows.length === 0 ? (
            <p className="text-fine text-muted">Подтверждённых финансовых фактов пока нет.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-fine">
                <thead>
                  <tr className="border-rule border-b text-micro text-muted uppercase tracking-wide">
                    <th className="px-2 py-2.5 text-left font-semibold">Дата</th>
                    <th className="px-2 py-2.5 text-left font-semibold">Заказ</th>
                    <th className="px-2 py-2.5 text-left font-semibold">Операция</th>
                    <th className="px-2 py-2.5 text-left font-semibold">Компания</th>
                    <th className="px-2 py-2.5 text-right font-semibold">Сумма</th>
                    <th className="px-2 py-2.5 text-left font-semibold">Статус</th>
                    <th className="px-2 py-2.5 text-left font-semibold">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-rule border-b align-top last:border-b-0">
                      <td className="whitespace-nowrap px-2 py-3 text-muted">
                        {formatDateTime(row.occurred_at)}
                      </td>
                      <td className="min-w-44 px-2 py-3 font-semibold">{relatedTitle(row)}</td>
                      <td className="px-2 py-3">
                        <p className="font-semibold">
                          {row.direction === 'inbound' ? 'Входящая' : 'Исходящая'}
                        </p>
                        <p className="text-micro text-muted">{KIND_LABEL[row.kind] ?? row.kind}</p>
                      </td>
                      <td className="px-2 py-3 text-muted">{companyName(row)}</td>
                      <td className="whitespace-nowrap px-2 py-3 text-right numeric">
                        {formatKzt(row.amount_kzt)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-3">
                        <Stamp tone={STATUS_TONE[row.status] ?? 'neutral'}>
                          {row.status === 'confirmed'
                            ? 'Подтверждено'
                            : row.status === 'pending'
                              ? 'Ожидает'
                              : row.status}
                        </Stamp>
                      </td>
                      <td className="max-w-44 break-words px-2 py-3 text-muted">
                        {row.reference ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Reveal>
    </div>
  );
}
