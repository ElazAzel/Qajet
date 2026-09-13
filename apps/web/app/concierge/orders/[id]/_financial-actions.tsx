'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { Button } from '@qajet/ui/primitives';
import { useState } from 'react';
import {
  confirmPrepayment,
  confirmSettlementPayment,
  confirmSupplierPayout,
  issuePrepaymentInvoice,
  type PaymentFactInput,
} from '../../../lib/actions/order-actions';

const inputClass =
  'w-full rounded-control border border-rule bg-page px-3 py-2 text-sm text-ink placeholder:text-muted focus-visible:border-purple';

export function PrepaymentActions({ orderId }: { orderId: string }) {
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const issue = useAsyncAction(issuePrepaymentInvoice);
  const confirm = useAsyncAction(confirmPrepayment);

  const input: PaymentFactInput = {
    amountKzt: Number(amount),
    reference,
  };

  return (
    <div className="mt-6 flex max-w-xl flex-col gap-4 rounded-card border border-rule bg-surface p-4">
      <div>
        <p className="text-sm font-semibold text-ink">Предоплата</p>
        <p className="mt-1 text-fine text-muted">
          Сначала выставьте счёт на P80 оценки. Статус «оплачено» появляется только после ручного
          подтверждения всей суммы; частичный перевод можно подтвердить отдельной записью и затем
          дополнять новыми банковскими фактами.
        </p>
      </div>
      <Button variant="secondary" loading={issue.pending} onClick={() => issue.run(orderId)}>
        {issue.pending ? 'Выставляю…' : 'Выставить счёт на P80'}
      </Button>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-fine text-muted">
          Фактически поступило, ₸
          <input
            type="number"
            min={1}
            step={1}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="text-fine text-muted">
          Банковский reference
          <input
            type="text"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            className={inputClass}
            placeholder="Платёжное поручение"
          />
        </label>
      </div>
      <Button
        variant="primary"
        loading={confirm.pending}
        disabled={!amount || !reference.trim()}
        onClick={() => confirm.run(orderId, input)}
      >
        {confirm.pending ? 'Подтверждаю…' : 'Подтвердить перевод и продолжить'}
      </Button>
      {(issue.error || confirm.error) && (
        <p className="text-fine text-signal">{issue.error ?? confirm.error}</p>
      )}
    </div>
  );
}

interface SupplierPayout {
  supplierCompanyId: string;
  supplierName: string;
  expectedAmountKzt: number;
}

export function SupplierPayoutActions({
  orderId,
  suppliers,
}: {
  orderId: string;
  suppliers: SupplierPayout[];
}) {
  return (
    <div className="mt-6 flex max-w-xl flex-col gap-4 rounded-card border border-rule bg-surface p-4">
      <div>
        <p className="text-sm font-semibold text-ink">Выплаты поставщикам</p>
        <p className="mt-1 text-fine text-muted">
          Каждый перевод подтверждается отдельно. Заказ продолжится после подтверждения полной суммы
          по всем поставщикам плана.
        </p>
      </div>
      {suppliers.map((supplier) => (
        <SupplierPayoutRow key={supplier.supplierCompanyId} orderId={orderId} supplier={supplier} />
      ))}
    </div>
  );
}

function SupplierPayoutRow({ orderId, supplier }: { orderId: string; supplier: SupplierPayout }) {
  const [reference, setReference] = useState('');
  const { run, pending, error } = useAsyncAction(confirmSupplierPayout);

  return (
    <div className="border-rule border-t pt-3 first:border-t-0 first:pt-0">
      <p className="text-fine font-semibold text-ink">{supplier.supplierName}</p>
      <p className="mt-1 text-fine text-muted">
        К выплате: {supplier.expectedAmountKzt.toLocaleString('ru-RU')} ₸
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex-1 text-fine text-muted">
          Reference
          <input
            type="text"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            className={inputClass}
            placeholder="Платёжное поручение"
          />
        </label>
        <Button
          variant="secondary"
          loading={pending}
          disabled={!reference.trim()}
          onClick={() =>
            run(orderId, supplier.supplierCompanyId, {
              amountKzt: supplier.expectedAmountKzt,
              reference,
            })
          }
        >
          Подтвердить выплату
        </Button>
      </div>
      {error && <p className="mt-1 text-fine text-signal">{error}</p>}
    </div>
  );
}

export function SettlementActions({
  orderId,
  kind,
  amountKzt,
}: {
  orderId: string;
  kind: 'refund' | 'surcharge' | 'exact';
  amountKzt: number;
}) {
  const [reference, setReference] = useState('');
  const { run, pending, error } = useAsyncAction(confirmSettlementPayment);

  if (kind === 'exact') {
    return (
      <div className="mt-6 max-w-xl rounded-card border border-rule bg-status-success-bg p-4">
        <p className="text-sm font-semibold text-ink">Сверка точная</p>
        <p className="mt-1 text-fine text-muted">
          Подтверждённые поступления уже равны согласованной стоимости заказа. Можно закрыть заказ.
        </p>
      </div>
    );
  }

  const isRefund = kind === 'refund';
  return (
    <div className="mt-6 flex max-w-xl flex-col gap-4 rounded-card border border-rule bg-surface p-4">
      <div>
        <p className="text-sm font-semibold text-ink">Финальная сверка</p>
        <p className="mt-1 text-fine text-muted">
          {isRefund ? 'Верните покупателю' : 'Получите доплату от покупателя'}{' '}
          <strong className="text-ink">{amountKzt.toLocaleString('ru-RU')} ₸</strong>. Сумма
          рассчитана из подтверждённых банковских фактов и не редактируется покупателем.
        </p>
      </div>
      <label className="text-fine text-muted">
        Банковский reference
        <input
          type="text"
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          className={inputClass}
          placeholder="Платёжное поручение"
        />
      </label>
      <Button
        variant={isRefund ? 'secondary' : 'primary'}
        loading={pending}
        disabled={!reference.trim()}
        onClick={() =>
          run(orderId, kind, {
            amountKzt,
            reference,
          })
        }
      >
        {pending ? 'Подтверждаю…' : isRefund ? 'Подтвердить возврат' : 'Подтвердить доплату'}
      </Button>
      {error && <p className="text-fine text-signal">{error}</p>}
    </div>
  );
}
