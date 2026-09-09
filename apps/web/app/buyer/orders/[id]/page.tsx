import { nextStatesFor } from '@qajet/engine/order';
import { Reveal, Stamp } from '@qajet/ui/motion';
import { Card, formatKzt, Money } from '@qajet/ui/primitives';
import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { loadBuyerOrder } from '../../../lib/buyer-order';
import { orderActorFor, requireCurrentUser } from '../../../lib/current-user';
import { ORDER_STATE_LABEL, ORDER_STATE_TONE } from '../../../lib/order-state';
import { supplierCountLabel } from '../../../lib/pluralize';
import { AcceptDeliveryCta, ApprovePlanCta, CloseOrderForm } from './_order-actions';
import { ShareOrderButton } from './_share-order-button';

const PLAN_LABEL: Record<string, string> = {
  recommended: 'Рекомендованный',
  cheaper: 'Дешевле',
  more_slack: 'С запасом по сроку',
};

export default async function BuyerOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const [user, order] = await Promise.all([requireCurrentUser(), loadBuyerOrder(supabase, id)]);
  if (!order) notFound();

  const actor = orderActorFor(user);
  const nextForBuyer = nextStatesFor(order.state, actor);
  const canApprove = actor === 'buyer' && nextForBuyer.includes('plan_approved');
  const canAccept = actor === 'buyer' && nextForBuyer.includes('accepted');
  const canClose = actor === 'buyer' && nextForBuyer.includes('closed');

  return (
    <div className="mx-auto max-w-2xl">
      <Reveal>
        <div className="flex items-start justify-between gap-4">
          <div>
            <Stamp tone={ORDER_STATE_TONE[order.state]} className="w-fit">
              {ORDER_STATE_LABEL[order.state]}
            </Stamp>
            <h1 className="mt-2 text-2xl font-extrabold text-ink">{order.requestTitle}</h1>
          </div>
          <ShareOrderButton orderId={order.id} title={order.requestTitle} />
        </div>
      </Reveal>

      {order.plan && order.plan.status !== 'draft' && (
        <Reveal className="mt-6" from="up">
          <Card padding="sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <span className="text-fine font-semibold text-muted">
                  {PLAN_LABEL[order.plan.kind] ?? order.plan.kind}
                </span>
                <p className="mt-0.5 text-xl font-extrabold text-ink">
                  <Money amountKzt={order.plan.totalKzt} />
                </p>
              </div>
              <div className="text-right text-fine text-muted">
                <p>
                  Срок {order.plan.etaDate ?? '—'} · запас {order.plan.slackDays ?? '—'} дн.
                </p>
                <p>
                  {order.plan.supplierCount} {supplierCountLabel(order.plan.supplierCount)}
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-fine">
                <span className="text-muted">Доставка</span>
                <span className="numeric text-ink">{formatKzt(order.plan.deliveryKzt)}</span>
              </div>
            </div>

            {canApprove && (
              <div className="mt-4">
                <ApprovePlanCta orderId={order.id} />
              </div>
            )}
          </Card>
        </Reveal>
      )}

      {canAccept && (
        <Reveal className="mt-6" from="up">
          <AcceptDeliveryCta orderId={order.id} />
        </Reveal>
      )}

      {canClose && (
        <Reveal className="mt-6" from="up">
          <CloseOrderForm orderId={order.id} />
        </Reveal>
      )}

      {order.closedAt && (
        <Reveal className="mt-6" from="up">
          <Card padding="sm">
            <p className="text-sm font-bold text-ink">Заказ закрыт</p>
            <div className="mt-2 flex items-center justify-between text-fine">
              <span className="text-muted">Итоговая стоимость</span>
              <span className="numeric text-ink">{formatKzt(order.finalCostKzt ?? 0)}</span>
            </div>
            {order.settlement && order.settlement !== 'exact' && (
              <div className="mt-1 flex items-center justify-between text-fine">
                <span className="text-muted">
                  {order.settlement === 'refund' ? 'Возврат покупателю' : 'Доплата от покупателя'}
                </span>
                <span className="numeric text-ink">
                  {formatKzt(Math.abs(order.settlementAmountKzt ?? 0))}
                </span>
              </div>
            )}
          </Card>
        </Reveal>
      )}

      <Reveal className="mt-6" from="up">
        <h2 className="text-sm font-bold text-ink">История заказа</h2>
        <div className="mt-3 flex flex-col">
          {order.events.map((event) => (
            <div
              key={`${event.toState}-${event.at}`}
              className="flex items-center justify-between gap-4 border-t border-rule py-3 first:border-t-0"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{event.toStateLabel}</p>
                {event.actorName && (
                  <p className="mt-0.5 text-fine text-muted">{event.actorName}</p>
                )}
              </div>
              <span className="shrink-0 text-fine text-muted">
                {new Date(event.at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
              </span>
            </div>
          ))}
        </div>
      </Reveal>
    </div>
  );
}
