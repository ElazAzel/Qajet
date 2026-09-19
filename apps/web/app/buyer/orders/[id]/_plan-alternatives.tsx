'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { Button, Card, formatKzt } from '@qajet/ui/primitives';
import { useRouter } from 'next/navigation';
import { selectPlan } from '../../../lib/actions/order-actions';
import type { BuyerOrderPlan } from '../../../lib/buyer-order';
import { PLAN_LABEL } from '../../../lib/order-state';

export function PlanAlternativeSelector({
  orderId,
  currentPlanId,
  alternatives,
}: {
  orderId: string;
  currentPlanId: string;
  alternatives: BuyerOrderPlan[];
}) {
  const router = useRouter();
  const { run, pending, error } = useAsyncAction(selectPlan, () => router.refresh());
  if (alternatives.length < 2) return null;

  return (
    <div className="mt-4 border-rule border-t pt-4">
      <p className="text-fine font-semibold text-ink">Выбор варианта</p>
      <p className="mt-1 text-fine text-muted">
        Все варианты относятся к одной проверенной ревизии. Выбранный вариант будет зафиксирован на
        экране подтверждения.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {alternatives.map((plan) => {
          const selected = plan.id === currentPlanId;
          return (
            <Card key={plan.id} padding="sm" className={selected ? 'border-purple' : undefined}>
              <p className="text-fine font-semibold text-ink">
                {PLAN_LABEL[plan.kind] ?? plan.kind}
              </p>
              <p className="mt-1 text-lg font-extrabold text-ink">{formatKzt(plan.totalKzt)}</p>
              <p className="mt-1 text-micro text-muted">
                Доставка {formatKzt(plan.deliveryKzt)} · запас {plan.slackDays ?? '—'} дн.
              </p>
              {plan.supplierRebateKzt > 0 && (
                <p className="mt-1 text-micro text-muted">
                  Вознаграждение поставщика {formatKzt(plan.supplierRebateKzt)}
                </p>
              )}
              <Button
                className="mt-3 w-full"
                variant={selected ? 'primary' : 'secondary'}
                size="sm"
                loading={pending && !selected}
                disabled={selected || pending}
                onClick={() => run(orderId, currentPlanId, plan.id)}
              >
                {selected ? 'Выбран' : 'Выбрать'}
              </Button>
            </Card>
          );
        })}
      </div>
      {error && <p className="mt-2 text-fine text-danger">{error}</p>}
    </div>
  );
}
