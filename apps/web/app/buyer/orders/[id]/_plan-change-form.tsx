'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { Button } from '@qajet/ui/primitives';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { requestPlanChange } from '../../../lib/actions/change-request-actions';

export function PlanChangeForm({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [supplierDelta, setSupplierDelta] = useState('0');
  const [deliveryDelta, setDeliveryDelta] = useState('0');
  const { run, pending, error } = useAsyncAction(requestPlanChange, () => router.refresh());
  return (
    <div className="mt-4 border-rule border-t pt-4">
      <p className="text-fine font-semibold text-ink">Нужно изменить условия?</p>
      <p className="mt-1 text-fine text-muted">
        Запрос уйдёт консьержу. Самостоятельная смена цены или состава невозможна: после решения
        QAJET появится новая версия плана, которую нужно подтвердить заново.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="text-fine text-muted sm:col-span-3">
          Что изменить
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={2000}
            required
            className="mt-1 w-full rounded-control border border-rule bg-page px-3 py-2 text-sm text-ink"
            placeholder="Например: нужен другой цвет упаковки"
          />
        </label>
        <label className="text-fine text-muted">
          Изменение закупки, ₸
          <input
            type="number"
            value={supplierDelta}
            onChange={(event) => setSupplierDelta(event.target.value)}
            className="mt-1 w-full rounded-control border border-rule bg-page px-3 py-2 text-sm text-ink"
          />
        </label>
        <label className="text-fine text-muted">
          Изменение доставки, ₸
          <input
            type="number"
            value={deliveryDelta}
            onChange={(event) => setDeliveryDelta(event.target.value)}
            className="mt-1 w-full rounded-control border border-rule bg-page px-3 py-2 text-sm text-ink"
          />
        </label>
      </div>
      <Button
        className="mt-3"
        variant="secondary"
        loading={pending}
        disabled={!reason.trim()}
        onClick={() =>
          run(orderId, {
            reason,
            supplierDeltaKzt: Number(supplierDelta),
            deliveryDeltaKzt: Number(deliveryDelta),
          })
        }
      >
        {pending ? 'Отправляю…' : 'Запросить изменение'}
      </Button>
      {error && <p className="mt-2 text-fine text-signal">{error}</p>}
    </div>
  );
}
