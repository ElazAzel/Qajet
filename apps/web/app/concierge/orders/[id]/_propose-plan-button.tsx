'use client';

import type { PlanKind } from '@qajet/engine/combine';
import { useAsyncAction } from '@qajet/ui/hooks';
import { Button } from '@qajet/ui/primitives';
import { proposePlan } from '../../../lib/actions/order-actions';

/**
 * Единственное реальное write-действие на экране сравнения — превращает
 * live-расчёт combine() в записанный plans/plan_lines и двигает заказ
 * quotes_received → plan_proposed (agents.md §6, packages/engine/order).
 */
export function ProposePlanButton({ requestId, kind }: { requestId: string; kind: PlanKind }) {
  const { run, pending, error } = useAsyncAction(proposePlan);

  return (
    <div className="mt-4 flex flex-col items-end gap-1.5">
      <Button variant="primary" loading={pending} onClick={() => run(requestId, kind)}>
        {pending ? 'Отправляю…' : 'Предложить этот план'}
      </Button>
      {error && <p className="max-w-xs text-right text-fine text-signal">{error}</p>}
    </div>
  );
}
