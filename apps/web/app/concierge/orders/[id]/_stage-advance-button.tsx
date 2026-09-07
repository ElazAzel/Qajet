'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { Button } from '@qajet/ui/primitives';
import { advanceOrderStage } from '../../../lib/actions/order-actions';
import type { OrderState } from '../../../lib/order-state';
import { ORDER_STATE_LABEL } from '../../../lib/order-state';

/** Операционные переходы staff (suppliers_paid…delivered, on_hold, cancelled) — agents.md §6. */
export function StageAdvanceButton({
  orderId,
  toState,
  primary = true,
}: {
  orderId: string;
  toState: OrderState;
  primary?: boolean;
}) {
  const { run, pending, error } = useAsyncAction(advanceOrderStage);

  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button
        variant={primary ? 'primary' : 'secondary'}
        loading={pending}
        onClick={() => run(orderId, toState)}
      >
        {pending ? 'Выполняю…' : `→ ${ORDER_STATE_LABEL[toState]}`}
      </Button>
      {error && <p className="text-fine text-signal">{error}</p>}
    </div>
  );
}
