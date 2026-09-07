'use client';

import type { PlanKind } from '@qajet/engine/combine';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { proposePlan } from '../../../lib/actions/order-actions';

/**
 * Единственное реальное write-действие на экране сравнения — превращает
 * live-расчёт combine() в записанный plans/plan_lines и двигает заказ
 * quotes_received → plan_proposed (agents.md §6, packages/engine/order).
 */
export function ProposePlanButton({ requestId, kind }: { requestId: string; kind: PlanKind }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'pending' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setState('pending');
    setError(null);
    const result = await proposePlan(requestId, kind);
    if (result.ok) {
      router.refresh();
      return;
    }
    setState('error');
    setError(result.error ?? 'Не удалось предложить план');
  }

  return (
    <div className="mt-4 flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={state === 'pending'}
        className="rounded-control bg-purple px-4 py-2 text-sm font-semibold text-white transition-colors duration-[var(--duration-instant)] hover:bg-purple/90 disabled:opacity-50"
      >
        {state === 'pending' ? 'Отправляю…' : 'Предложить этот план'}
      </button>
      {error && <p className="max-w-xs text-right text-fine text-signal">{error}</p>}
    </div>
  );
}
