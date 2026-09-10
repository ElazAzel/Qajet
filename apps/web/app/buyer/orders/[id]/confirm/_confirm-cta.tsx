'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { Button } from '@qajet/ui/primitives';
import { useRouter } from 'next/navigation';
import { approvePlan } from '../../../../lib/actions/order-actions';
import { hapticSuccess } from '../../../../lib/native-bridge';

/**
 * Подтверждение — то же действие `approvePlan()`, что и раньше, но после
 * экрана с реквизитами и условиями (agents.md §11.3). Версия плана
 * показывается прямо в подписи под кнопкой: подтверждают конкретную
 * версию, и ровно она записывается в audit log.
 */
export function ConfirmPlanCta({ orderId, planVersion }: { orderId: string; planVersion: number }) {
  const router = useRouter();
  const { run, pending, error } = useAsyncAction(async (id: string) => {
    const result = await approvePlan(id);
    if (result.ok) {
      hapticSuccess();
      router.push(`/buyer/orders/${id}`);
    }
    return result;
  });

  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button variant="primary" loading={pending} onClick={() => run(orderId)}>
        {pending ? 'Подтверждаю…' : 'Подтверждаю заказ на этих условиях'}
      </Button>
      <p className="text-fine text-muted">
        Будет зафиксировано: кто, когда и какую версию плана подтвердил (версия {planVersion}).
      </p>
      {error && <p className="text-fine text-signal">{error}</p>}
    </div>
  );
}
