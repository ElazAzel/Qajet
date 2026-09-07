'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { advanceOrderStage, approvePlan } from '../../../lib/actions/order-actions';

/** Общая обёртка: кнопка + состояние pending/error, чтобы не повторять её трижды. */
function useOrderAction(run: () => Promise<{ ok: boolean; error?: string }>) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'pending' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function trigger() {
    setState('pending');
    setError(null);
    const result = await run();
    if (result.ok) {
      router.refresh();
      return;
    }
    setState('error');
    setError(result.error ?? 'Не удалось выполнить действие');
  }

  return { trigger, pending: state === 'pending', error };
}

export function ApprovePlanCta({ orderId }: { orderId: string }) {
  const { trigger, pending, error } = useOrderAction(() => approvePlan(orderId));
  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={trigger}
        disabled={pending}
        className="rounded-control bg-purple px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-[var(--duration-instant)] hover:bg-purple/90 disabled:opacity-50"
      >
        {pending ? 'Утверждаю…' : 'Утвердить план'}
      </button>
      {error && <p className="text-fine text-signal">{error}</p>}
    </div>
  );
}

export function AcceptDeliveryCta({ orderId }: { orderId: string }) {
  const { trigger, pending, error } = useOrderAction(() => advanceOrderStage(orderId, 'accepted'));
  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={trigger}
        disabled={pending}
        className="rounded-control bg-purple px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-[var(--duration-instant)] hover:bg-purple/90 disabled:opacity-50"
      >
        {pending ? 'Принимаю…' : 'Принять поставку'}
      </button>
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
  const { trigger, pending, error } = useOrderAction(() =>
    advanceOrderStage(orderId, 'closed', {
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
      <button
        type="button"
        onClick={trigger}
        disabled={pending}
        className="self-start rounded-control bg-purple px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-[var(--duration-instant)] hover:bg-purple/90 disabled:opacity-50"
      >
        {pending ? 'Закрываю…' : 'Закрыть заказ'}
      </button>
      {error && <p className="text-fine text-signal">{error}</p>}
    </div>
  );
}
