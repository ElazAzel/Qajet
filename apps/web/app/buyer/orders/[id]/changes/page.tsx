import { Card } from '@qajet/ui/primitives';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { loadBuyerOrder } from '../../../../lib/buyer-order';
import { requireCurrentUser } from '../../../../lib/current-user';

const STATUS_LABEL: Record<string, string> = {
  pending: 'На рассмотрении',
  accepted: 'Принято',
  declined: 'Отклонено',
};

export default async function BuyerOrderChangesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireCurrentUser();
  const supabase = await createSupabaseServerClient();
  const order = await loadBuyerOrder(supabase, id);
  if (!order) notFound();

  const { data: changes } = await supabase
    .from('change_requests')
    .select('id, status, diff, created_at, updated_at, proposed_plan_id')
    .eq('order_id', order.id)
    .order('created_at', { ascending: false });

  return (
    <div className="mx-auto max-w-2xl">
      <p className="text-fine text-muted">
        <Link href={`/buyer/orders/${order.id}`} className="hover:text-ink">
          Заказ
        </Link>
        <span className="mx-1.5">›</span>
        Изменения условий
      </p>
      <h1 className="mt-2 text-2xl font-extrabold text-ink">История изменений</h1>
      <p className="mt-1 text-sm text-muted">
        Каждый запрос хранится вместе с решением и версией плана. Новая версия не заменяет старую
        бесследно и требует повторного подтверждения.
      </p>

      {changes?.length ? (
        <div className="mt-6 flex flex-col gap-3">
          {changes.map((change) => {
            const diff = (change.diff ?? {}) as {
              reason?: unknown;
              requestedSupplierDeltaKzt?: unknown;
              requestedDeliveryDeltaKzt?: unknown;
              appliedPlanId?: unknown;
            };
            return (
              <Card key={change.id} padding="sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-bold text-ink">
                    {STATUS_LABEL[change.status] ?? change.status}
                  </p>
                  <time className="text-micro text-muted">
                    {new Date(change.created_at).toLocaleString('ru-RU')}
                  </time>
                </div>
                <p className="mt-2 text-fine text-ink">
                  {typeof diff.reason === 'string' ? diff.reason : 'Без комментария'}
                </p>
                <p className="mt-2 text-fine text-muted">
                  Закупка: {formatDelta(diff.requestedSupplierDeltaKzt)} · доставка:{' '}
                  {formatDelta(diff.requestedDeliveryDeltaKzt)}
                </p>
                {(change.proposed_plan_id || diff.appliedPlanId) && (
                  <p className="mt-1 text-micro text-muted">
                    План: {String(diff.appliedPlanId ?? change.proposed_plan_id)}
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="mt-6" padding="sm">
          <p className="text-sm font-semibold text-ink">Запросов пока нет</p>
          <p className="mt-1 text-fine text-muted">
            Если условия заказа нужно изменить, вернитесь к заказу и отправьте запрос QAJET.
          </p>
        </Card>
      )}
    </div>
  );
}

function formatDelta(value: unknown): string {
  return `${Number(value ?? 0).toLocaleString('ru-RU')} ₸`;
}
