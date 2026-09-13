'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { Button } from '@qajet/ui/primitives';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { submitQuote } from '../../../lib/actions/supplier-actions';

interface RequestItemRow {
  id: string;
  name: string;
  qty: number;
  unit: string;
  category: string;
}

interface LineDraft {
  unitPriceKzt: string;
  leadTimeDays: string;
  setupFeeKzt: string;
  minQty: string;
  capabilityConfirmed: boolean;
}

const inputClass =
  'w-full rounded-control border border-transparent bg-page px-3 py-2 text-sm text-ink placeholder:text-muted focus-visible:border-purple';

export function QuoteForm({
  rfqId,
  items,
  revision = false,
}: {
  rfqId: string;
  items: RequestItemRow[];
  revision?: boolean;
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({});

  const { run, pending, error } = useAsyncAction(submitQuote, () => {
    router.push('/supplier');
  });

  function patch(itemId: string, field: keyof LineDraft, value: string | boolean) {
    setDrafts((prev) => ({
      ...prev,
      [itemId]: {
        unitPriceKzt: '',
        leadTimeDays: '',
        setupFeeKzt: '',
        minQty: '',
        capabilityConfirmed: false,
        ...prev[itemId],
        [field]: value,
      },
    }));
  }

  function handleSubmit() {
    const lines = items
      .map((item) => {
        const draft = drafts[item.id];
        const unitPriceKzt = Number(draft?.unitPriceKzt);
        const leadTimeDays = Number(draft?.leadTimeDays);
        if (!draft || !unitPriceKzt || !leadTimeDays) return null;
        return {
          requestItemId: item.id,
          unitPriceKzt,
          leadTimeDays,
          capabilityConfirmed: draft.capabilityConfirmed,
          setupFeeKzt: draft.setupFeeKzt ? Number(draft.setupFeeKzt) : undefined,
          minQty: draft.minQty ? Number(draft.minQty) : undefined,
        };
      })
      .filter((line): line is NonNullable<typeof line> => line !== null);
    run(rfqId, lines);
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      {items.map((item) => {
        const draft = drafts[item.id] ?? {
          unitPriceKzt: '',
          leadTimeDays: '',
          setupFeeKzt: '',
          minQty: '',
          capabilityConfirmed: false,
        };
        return (
          <div key={item.id} className="rounded-card border border-rule bg-surface p-4">
            <p className="text-sm font-semibold">{item.name}</p>
            <p className="mb-3 text-fine text-muted">
              {item.qty} {item.unit}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <label className="block">
                <span className="mb-1 block text-micro font-semibold text-muted">
                  Цена за ед., ₸
                </span>
                <input
                  type="number"
                  min={0}
                  value={draft.unitPriceKzt}
                  onChange={(e) => patch(item.id, 'unitPriceKzt', e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-micro font-semibold text-muted">Срок, дней</span>
                <input
                  type="number"
                  min={1}
                  value={draft.leadTimeDays}
                  onChange={(e) => patch(item.id, 'leadTimeDays', e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-micro font-semibold text-muted">Setup fee, ₸</span>
                <input
                  type="number"
                  min={0}
                  value={draft.setupFeeKzt}
                  onChange={(e) => patch(item.id, 'setupFeeKzt', e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-micro font-semibold text-muted">
                  Мин. партия, шт.
                </span>
                <input
                  type="number"
                  min={1}
                  value={draft.minQty}
                  onChange={(e) => patch(item.id, 'minQty', e.target.value)}
                  className={inputClass}
                />
              </label>
            </div>
            <label className="mt-3 flex items-start gap-2 text-fine text-muted">
              <input
                type="checkbox"
                checked={draft.capabilityConfirmed}
                onChange={(event) => patch(item.id, 'capabilityConfirmed', event.target.checked)}
                className="mt-0.5 accent-purple"
              />
              <span>Подтверждаю, что могу исполнить эту позицию и указанные условия.</span>
            </label>
          </div>
        );
      })}

      <div className="flex items-center justify-between">
        <p className="text-fine text-muted">
          Оставьте пустыми позиции, по которым не даёте цену. Незаполненные условия сохранятся как
          требующие уточнения.
        </p>
        <Button variant="primary" loading={pending} onClick={handleSubmit}>
          {pending ? 'Отправляю…' : revision ? 'Отправить исправленное КП' : 'Отправить КП'}
        </Button>
      </div>
      {error && <p className="text-fine text-signal">{error}</p>}
    </div>
  );
}
