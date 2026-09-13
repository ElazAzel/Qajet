'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { Button, buttonClass } from '@qajet/ui/primitives';
import Link from 'next/link';
import { useState } from 'react';
import {
  advanceOrderStage,
  rateSupplier,
  type SupplierRatingInput,
} from '../../../lib/actions/order-actions';
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

export function CloseOrderForm({ orderId }: { orderId: string }) {
  const { run, pending, error } = useAsyncAction((id: string) => advanceOrderStage(id, 'closed'));

  return (
    <div className="flex flex-col gap-3 rounded-card border border-rule bg-page p-4">
      <p className="text-sm font-semibold text-ink">Закрытие со сверкой</p>
      <p className="text-fine text-muted">
        Тип и сумма сверки рассчитываются по согласованному плану и подтверждённым банковским
        фактам. Если требуется возврат или доплата, сотрудник QAJET сначала фиксирует перевод.
      </p>
      <Button
        variant="primary"
        loading={pending}
        className="self-start"
        onClick={() => run(orderId)}
      >
        {pending ? 'Подтверждаю…' : 'Подтвердить сверку и закрыть'}
      </Button>
      {error && <p className="text-fine text-signal">{error}</p>}
    </div>
  );
}

export function SupplierRatingForm({
  orderId,
  supplierCompanyId,
  index,
}: {
  orderId: string;
  supplierCompanyId: string;
  index: number;
}) {
  const [score, setScore] = useState('5');
  const [wasOnTime, setWasOnTime] = useState('true');
  const [hadDispute, setHadDispute] = useState(false);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const { run, pending, error } = useAsyncAction(
    (input: SupplierRatingInput) => rateSupplier(orderId, supplierCompanyId, input),
    () => setSubmitted(true),
  );

  if (submitted) {
    return <p className="text-fine text-status-success-fg">Оценка сохранена — спасибо.</p>;
  }

  return (
    <div className="flex flex-col gap-3 border-rule border-t pt-3 first:border-t-0 first:pt-0">
      <p className="text-sm font-semibold text-ink">Исполнитель {index + 1}</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-fine text-muted">
          Оценка
          <select
            value={score}
            onChange={(event) => setScore(event.target.value)}
            className="rounded-control border border-rule bg-surface px-3 py-2 text-sm text-ink"
          >
            {[5, 4, 3, 2, 1].map((value) => (
              <option key={value} value={value}>
                {value} из 5
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-fine text-muted">
          В срок?
          <select
            value={wasOnTime}
            onChange={(event) => setWasOnTime(event.target.value)}
            className="rounded-control border border-rule bg-surface px-3 py-2 text-sm text-ink"
          >
            <option value="true">Да</option>
            <option value="false">Нет</option>
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2 text-fine text-muted">
        <input
          type="checkbox"
          checked={hadDispute}
          onChange={(event) => setHadDispute(event.target.checked)}
        />
        Был спор по заказу
      </label>
      <label className="flex flex-col gap-1 text-fine text-muted">
        Комментарий <span className="text-muted">необязательно</span>
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          maxLength={2000}
          rows={2}
          className="rounded-control border border-rule bg-surface px-3 py-2 text-sm text-ink"
          placeholder="Что стоит учесть в следующий раз?"
        />
      </label>
      <Button
        variant="secondary"
        loading={pending}
        className="self-start"
        onClick={() =>
          run({
            buyerScore1To5: Number(score),
            wasOnTime: wasOnTime === 'true',
            hadDispute,
            comment,
          })
        }
      >
        {pending ? 'Сохраняю…' : 'Сохранить оценку'}
      </Button>
      {error && <p className="text-fine text-signal">{error}</p>}
    </div>
  );
}
