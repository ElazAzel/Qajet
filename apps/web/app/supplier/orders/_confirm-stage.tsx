'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { Button } from '@qajet/ui/primitives';
import { confirmSupplierStage } from '../../lib/actions/supplier-actions';

/**
 * Кнопки стадий, которые поставщик подтверждает сам (§10). Какие именно —
 * решает граф состояний (`nextStatesFor(state, 'supplier')` в
 * `supplier-orders.ts`), а не условие в этом компоненте: список, зашитый
 * в UI, разошёлся бы с графом молча.
 */
export function ConfirmStage({
  orderId,
  options,
}: {
  orderId: string;
  options: { state: string; label: string }[];
}) {
  // router.refresh() при успехе делает сам useAsyncAction.
  const { run, pending, error } = useAsyncAction((state: string) =>
    confirmSupplierStage(orderId, state),
  );

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            key={option.state}
            size="sm"
            variant="secondary"
            loading={pending}
            onClick={() => run(option.state)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      {error && <p className="text-micro text-danger">{error}</p>}
    </div>
  );
}
