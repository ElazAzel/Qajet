'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { Button, buttonClass } from '@qajet/ui/primitives';
import Link from 'next/link';
import { useState } from 'react';
import { advanceOrderStage } from '../../../lib/actions/order-actions';
import { hapticSuccess } from '../../../lib/native-bridge';

/**
 * Ведёт на экран подтверждения, а не утверждает сразу: §11.3 требует
 * показать реквизиты, состав, срок, порядок оплаты и условия возврата ДО
 * согласия. Само `approvePlan()` вызывается там (confirm/_confirm-cta.tsx).
 */
export function ApprovePlanCta({ orderId }: { orderId: string }) {
  return (
    <Link href={`/buyer/orders/${orderId}/confirm`} className={buttonClass('primary')}>
      Перейти к подтверждению
    </Link>
  );
}

export function AcceptDeliveryCta({ orderId }: { orderId: string }) {
  const { run, pending, error } = useAsyncAction(
    (id: string) => advanceOrderStage(id, 'accepted'),
    hapticSuccess,
  );
  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button variant="primary" loading={pending} onClick={() => run(orderId)}>
        {pending ? 'Принимаю…' : 'Принять поставку'}
      </Button>
      {error && <p className="text-fine text-signal">{error}</p>}
    </div>
  );
}

const SETTLEMENT_LABEL: Record<'exact', string> & Record<'refund' | 'surcharge', string> = {
  exact: 'Точно по плану — без сверки',
  refund: 'Возврат покупателю',
  surcharge: 'Доплата от покупателя',
};

export function CloseOrderForm({ orderId }: { orderId: string }) {
  const [settlement, setSettlement] = useState<'refund' | 'surcharge' | 'exact'>('exact');
  const [amount, setAmount] = useState('');
  const { run, pending, error } = useAsyncAction((id: string) =>
    advanceOrderStage(id, 'closed', {
      settlement,
      settlementAmountKzt: settlement === 'exact' ? 0 : Number(amount) || 0,
    }),
  );

  return (
    <div className="flex flex-col gap-3 rounded-card border border-rule bg-page p-4">
      <p className="text-sm font-semibold text-ink">Закрытие со сверкой</p>
      <div className="flex flex-col gap-2">
        {(Object.keys(SETTLEMENT_LABEL) as Array<keyof typeof SETTLEMENT_LABEL>).map((key) => (
          <label key={key} className="flex items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              name="settlement"
              value={key}
              checked={settlement === key}
              onChange={() => setSettlement(key)}
            />
            {SETTLEMENT_LABEL[key]}
          </label>
        ))}
      </div>
      {settlement !== 'exact' && (
        <label className="flex flex-col gap-1 text-fine text-muted">
          Сумма, ₸
          <input
            type="number"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="rounded-control border border-rule bg-surface px-3 py-2 text-sm text-ink"
            placeholder="0"
          />
        </label>
      )}
      <Button
        variant="primary"
        loading={pending}
        className="self-start"
        onClick={() => run(orderId)}
      >
        {pending ? 'Закрываю…' : 'Закрыть заказ'}
      </Button>
      {error && <p className="text-fine text-signal">{error}</p>}
    </div>
  );
}
