'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { Button } from '@qajet/ui/primitives';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  declineRfqByLink,
  type QuoteLineInput,
  quickRespondRfqByLink,
  submitQuoteByLink,
} from '../../../lib/actions/supplier-actions';

export interface PublicRfqItem {
  id: string;
  name: string;
  qty: number;
  unit: string;
  category: string;
}

export interface PublicRfqDetail {
  rfqId: string;
  status: 'sent' | 'quick_responded' | 'quoted' | 'declined';
  respondBy: string | null;
  request: { title: string; deadlineDate: string | null };
  items: PublicRfqItem[];
}

export function PublicRfqResponse({ token, detail }: { token: string; detail: PublicRfqDetail }) {
  if (detail.status === 'quoted') {
    return <StatusMessage>КП уже отправлено. Спасибо за ответ.</StatusMessage>;
  }
  if (detail.status === 'declined') {
    return <StatusMessage>По этому RFQ уже зафиксирован отказ.</StatusMessage>;
  }
  if (detail.status === 'sent') return <QuickResponse token={token} />;
  return <PublicQuoteForm token={token} items={detail.items} />;
}

function QuickResponse({ token }: { token: string }) {
  const router = useRouter();
  const quick = useAsyncAction(quickRespondRfqByLink, () => router.refresh());
  const decline = useAsyncAction(declineRfqByLink, () => router.refresh());

  return (
    <div className="mt-6 rounded-card border border-rule bg-surface p-5">
      <p className="text-sm text-muted">
        Подтвердите намерение ответить. Цена и срок заполняются следующим шагом.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button loading={quick.pending} onClick={() => quick.run(token)}>
          {quick.pending ? 'Сохраняю…' : 'Берусь за заказ'}
        </Button>
        <Button variant="secondary" loading={decline.pending} onClick={() => decline.run(token)}>
          Не берусь
        </Button>
      </div>
      {(quick.error || decline.error) && (
        <p className="mt-2 text-fine text-signal">{quick.error ?? decline.error}</p>
      )}
    </div>
  );
}

function PublicQuoteForm({ token, items }: { token: string; items: PublicRfqItem[] }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const { run, pending, error } = useAsyncAction(submitQuoteByLink, () => router.refresh());

  function patch(itemId: string, field: string, value: string) {
    setDrafts((current) => ({
      ...current,
      [itemId]: { ...current[itemId], [field]: value },
    }));
  }

  function submit() {
    const lines: QuoteLineInput[] = items.flatMap((item) => {
      const draft = drafts[item.id];
      const unitPriceKzt = Number(draft?.unitPriceKzt);
      const leadTimeDays = Number(draft?.leadTimeDays);
      if (!draft || !unitPriceKzt || !leadTimeDays) return [];
      return [
        {
          requestItemId: item.id,
          unitPriceKzt,
          leadTimeDays,
          setupFeeKzt: draft.setupFeeKzt ? Number(draft.setupFeeKzt) : undefined,
          minQty: draft.minQty ? Number(draft.minQty) : undefined,
        },
      ];
    });
    run(token, lines);
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      <p className="text-fine text-muted">
        Укажите цену и срок по тем позициям, которые готовы выполнить.
      </p>
      {items.map((item) => {
        const draft = drafts[item.id] ?? {};
        return (
          <div key={item.id} className="rounded-card border border-rule bg-surface p-4">
            <p className="text-sm font-semibold">{item.name}</p>
            <p className="mb-3 text-fine text-muted">
              {item.qty} {item.unit}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <PublicNumberInput
                label="Цена за ед., ₸"
                value={draft.unitPriceKzt ?? ''}
                onChange={(value) => patch(item.id, 'unitPriceKzt', value)}
              />
              <PublicNumberInput
                label="Срок, дней"
                value={draft.leadTimeDays ?? ''}
                onChange={(value) => patch(item.id, 'leadTimeDays', value)}
              />
              <PublicNumberInput
                label="Подготовка, ₸"
                value={draft.setupFeeKzt ?? ''}
                onChange={(value) => patch(item.id, 'setupFeeKzt', value)}
              />
              <PublicNumberInput
                label="Мин. партия, шт."
                value={draft.minQty ?? ''}
                onChange={(value) => patch(item.id, 'minQty', value)}
              />
            </div>
          </div>
        );
      })}
      <div className="flex items-center justify-between gap-3">
        <p className="text-fine text-muted">
          Пустые строки не попадут в КП. Незаполненные условия сохранятся как требующие уточнения.
        </p>
        <Button loading={pending} onClick={submit}>
          {pending ? 'Отправляю…' : 'Отправить КП'}
        </Button>
      </div>
      {error && <p className="text-fine text-signal">{error}</p>}
    </div>
  );
}

function PublicNumberInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-micro font-semibold text-muted">{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-control border border-transparent bg-page px-3 py-2 text-sm text-ink focus-visible:border-purple"
      />
    </label>
  );
}

function StatusMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 rounded-card border border-rule bg-surface p-6 text-fine text-muted">
      {children}
    </div>
  );
}
