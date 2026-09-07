'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
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
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'pending' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setState('pending');
    setError(null);
    const result = await advanceOrderStage(orderId, toState);
    if (result.ok) {
      router.refresh();
      return;
    }
    setState('error');
    setError(result.error ?? 'Не удалось выполнить переход');
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={state === 'pending'}
        className={
          primary
            ? 'rounded-control bg-purple px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-[var(--duration-instant)] hover:bg-purple/90 disabled:opacity-50'
            : 'rounded-control border border-rule px-4 py-2.5 text-sm font-semibold text-muted transition-colors duration-[var(--duration-instant)] hover:bg-page disabled:opacity-50'
        }
      >
        {state === 'pending' ? 'Выполняю…' : `→ ${ORDER_STATE_LABEL[toState]}`}
      </button>
      {error && <p className="text-fine text-signal">{error}</p>}
    </div>
  );
}
