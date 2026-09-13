'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { Button } from '@qajet/ui/primitives';
import { useState } from 'react';
import { advanceOrderStage } from '../../../lib/actions/order-actions';
import type { OrderState } from '../../../lib/order-state';
import { ORDER_STATE_LABEL } from '../../../lib/order-state';

/** Операционные переходы staff (suppliers_paid…shipped, on_hold, cancelled) — agents.md §6. */
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
  const [reason, setReason] = useState('');
  const needsReason = toState === 'on_hold' || toState === 'cancelled' || toState === 'disputed';

  return (
    <div className="flex flex-col items-start gap-1.5">
      {needsReason && (
        <label className="flex w-full min-w-64 flex-col gap-1 text-fine text-muted">
          Причина
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            minLength={5}
            maxLength={2000}
            rows={2}
            className="rounded-control border border-rule bg-surface px-3 py-2 text-sm text-ink"
            placeholder="Что произошло и какой следующий шаг нужен?"
          />
        </label>
      )}
      <Button
        variant={primary ? 'primary' : 'secondary'}
        loading={pending}
        disabled={needsReason && reason.trim().length < 5}
        onClick={() => run(orderId, toState, needsReason ? { reason } : {})}
      >
        {pending ? 'Выполняю…' : `→ ${ORDER_STATE_LABEL[toState]}`}
      </Button>
      {error && <p className="text-fine text-signal">{error}</p>}
    </div>
  );
}
