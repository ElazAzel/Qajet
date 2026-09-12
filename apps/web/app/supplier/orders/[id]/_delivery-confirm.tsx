'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { Button } from '@qajet/ui/primitives';
import { useState } from 'react';
import { confirmSupplierDelivery } from '../../../lib/actions/supplier-actions';

export function DeliveryConfirmButton({ orderId }: { orderId: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const { run, pending, error } = useAsyncAction(confirmSupplierDelivery, (result) => {
    setMessage(
      result.delivered
        ? 'Заказ отмечен как доставленный. Ожидается приёмка покупателем.'
        : 'Подтверждение записано. Ожидается подтверждение остальных поставщиков.',
    );
  });

  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button loading={pending} onClick={() => run(orderId)}>
        {pending ? 'Подтверждаю…' : 'Подтвердить доставку'}
      </Button>
      {message && <p className="text-fine text-muted">{message}</p>}
      {error && <p className="text-fine text-signal">{error}</p>}
    </div>
  );
}
