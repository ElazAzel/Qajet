'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { Button, Card } from '@qajet/ui/primitives';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { advanceOrderStage } from '../../../lib/actions/order-actions';

export function BuyerIssueActions({
  orderId,
  canCancel,
  canDispute,
}: {
  orderId: string;
  canCancel: boolean;
  canDispute: boolean;
}) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const { run, pending, error } = useAsyncAction(advanceOrderStage, () => router.refresh());

  if (!canCancel && !canDispute) return null;

  return (
    <Card padding="sm">
      <p className="text-sm font-semibold text-ink">Нужна помощь с заказом?</p>
      <p className="mt-1 text-fine text-muted">
        Опишите ситуацию. Причина попадёт в журнал заказа, а команда QAJET продолжит процесс по
        правилам.
      </p>
      <label className="mt-3 flex flex-col gap-1 text-fine text-muted">
        Причина
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          minLength={5}
          maxLength={2000}
          rows={3}
          className="rounded-control border border-rule bg-surface px-3 py-2 text-sm text-ink"
          placeholder={
            canDispute ? 'Что не соответствует поставке?' : 'Почему заказ нужно отменить?'
          }
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        {canDispute && (
          <Button
            variant="primary"
            loading={pending}
            disabled={reason.trim().length < 5}
            onClick={() => run(orderId, 'disputed', { reason })}
          >
            Открыть спор
          </Button>
        )}
        {canCancel && (
          <Button
            variant="secondary"
            loading={pending}
            disabled={reason.trim().length < 5}
            onClick={() => run(orderId, 'cancelled', { reason })}
          >
            Отменить заказ
          </Button>
        )}
      </div>
      {error && <p className="mt-2 text-fine text-signal">{error}</p>}
    </Card>
  );
}
