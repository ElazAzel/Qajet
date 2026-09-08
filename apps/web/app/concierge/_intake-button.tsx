'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { Button } from '@qajet/ui/primitives';
import { useRouter } from 'next/navigation';
import { intakeRequest } from '../lib/actions/order-actions';

/** Заявка становится заказом здесь — плейсхолдер-план + orders(draft), agents.md §6. */
export function IntakeButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const { run, pending, error } = useAsyncAction(intakeRequest, (result) => {
    if (result.orderId) router.push(`/concierge/orders/${result.orderId}`);
  });

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="primary" size="sm" loading={pending} onClick={() => run(requestId)}>
        {pending ? 'Беру…' : 'Взять в работу'}
      </Button>
      {error && <p className="max-w-[160px] text-right text-micro text-signal">{error}</p>}
    </div>
  );
}
