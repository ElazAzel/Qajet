'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { Button } from '@qajet/ui/primitives';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { reorderItem } from '../../lib/actions/request-actions';
import type { ReorderCandidate } from '../../lib/buyer-reorder';

/**
 * Карточка повтора — «в один клик с новым количеством» (agents.md §10):
 * тираж уже подставлен из прошлого заказа, менять его необязательно.
 */
export function ReorderCard({ candidate }: { candidate: ReorderCandidate }) {
  const router = useRouter();
  const [qty, setQty] = useState(candidate.lastQty);
  // Повторный клик или повтор после обрыва сети не создаёт вторую заявку.
  const [submissionKey] = useState(() => crypto.randomUUID());
  const { run, pending, error } = useAsyncAction(async () => {
    if (!candidate.itemKey) return { ok: false, error: 'Позиции больше нет в каталоге' };
    const result = await reorderItem(candidate.itemKey, qty, submissionKey);
    if (result.ok && result.requestId) router.push(`/buyer/requests/${result.requestId}`);
    return result;
  });

  return (
    <div className="flex flex-col rounded-card border border-rule bg-surface p-5">
      <p className="mb-1 text-sm font-semibold">{candidate.name}</p>
      <p className="mb-3 text-fine text-muted">{candidate.categoryLabel}</p>
      <p className="mb-4 text-fine text-muted">
        Заказан {candidate.timesOrdered} {pluralTimes(candidate.timesOrdered)} · последний{' '}
        {formatMonth(candidate.lastOrderedAt)} · тираж {candidate.lastQty}
      </p>

      <div className="mt-auto flex items-end gap-2 border-rule border-t pt-4">
        <label className="flex-1">
          <span className="mb-1.5 block text-fine font-semibold">Тираж</span>
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
            className="w-full rounded-control bg-page px-3 py-2 text-sm text-ink"
          />
        </label>
        <Button
          variant="primary"
          size="sm"
          loading={pending}
          disabled={!candidate.itemKey || qty <= 0}
          onClick={run}
        >
          Повторить
        </Button>
      </div>

      {!candidate.itemKey && (
        <p className="mt-2 text-fine text-muted">
          Позиции больше нет в справочнике — заведите заявку вручную.
        </p>
      )}
      {error && <p className="mt-2 text-fine text-danger">{error}</p>}
    </div>
  );
}

function pluralTimes(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'раз';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'раза';
  return 'раз';
}

function formatMonth(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
}
