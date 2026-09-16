'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { Button } from '@qajet/ui/primitives';
import { useState } from 'react';
import { updateSupplierProfile } from '../../lib/actions/supplier-actions';
import type { SupplierProfile } from '../../lib/supplier-profile';

export function ProfileForm({ profile }: { profile: SupplierProfile }) {
  const [minOrder, setMinOrder] = useState(profile.minOrderKzt?.toString() ?? '');
  const [leadTime, setLeadTime] = useState(profile.leadTimeDaysDefault?.toString() ?? '');
  const [portfolio, setPortfolio] = useState(profile.portfolioUrls.join('\n'));
  const [notes, setNotes] = useState(profile.notes ?? '');

  const { run, pending, error } = useAsyncAction(() =>
    updateSupplierProfile({
      minOrderKzt: minOrder.trim() === '' ? null : Number(minOrder),
      leadTimeDaysDefault: leadTime.trim() === '' ? null : Number(leadTime),
      portfolioUrls: portfolio
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      notes: notes.trim() === '' ? null : notes.trim(),
    }),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label>
          <span className="mb-1 block text-micro text-muted">Минимальная сумма заказа, ₸</span>
          <input
            type="number"
            step={1000}
            value={minOrder}
            onChange={(e) => setMinOrder(e.target.value)}
            placeholder="без минимума"
            className="w-full rounded-control bg-page px-3 py-2 text-fine text-ink"
          />
        </label>
        <label>
          <span className="mb-1 block text-micro text-muted">Срок поставки по умолчанию, дней</span>
          <input
            type="number"
            step={1}
            value={leadTime}
            onChange={(e) => setLeadTime(e.target.value)}
            placeholder="не задан"
            className="w-full rounded-control bg-page px-3 py-2 text-fine text-ink"
          />
        </label>
      </div>
      <label>
        <span className="mb-1 block text-micro text-muted">Портфолио — по ссылке в строке</span>
        <textarea
          rows={3}
          value={portfolio}
          onChange={(e) => setPortfolio(e.target.value)}
          placeholder="https://…"
          className="w-full rounded-control bg-page px-3 py-2 text-fine text-ink"
        />
      </label>
      <label>
        <span className="mb-1 block text-micro text-muted">Заметка о себе</span>
        <textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full rounded-control bg-page px-3 py-2 text-fine text-ink"
        />
      </label>
      <div>
        <Button variant="primary" size="sm" loading={pending} onClick={run}>
          Сохранить
        </Button>
        {error && <p className="mt-1.5 text-fine text-danger">{error}</p>}
      </div>
    </div>
  );
}
