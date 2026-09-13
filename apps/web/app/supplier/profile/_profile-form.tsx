'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { Button } from '@qajet/ui/primitives';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  type SupplierProfileInput,
  updateSupplierProfile,
} from '../../lib/actions/supplier-profile-actions';

const inputClass =
  'w-full rounded-control border border-rule bg-page px-3 py-2 text-sm text-ink placeholder:text-muted';

export function SupplierProfileForm({
  initial,
  canManage,
}: {
  initial: SupplierProfileInput;
  canManage: boolean;
}) {
  const router = useRouter();
  const [categories, setCategories] = useState(initial.categories.join(', '));
  const [capabilities, setCapabilities] = useState(initial.capabilities.join(', '));
  const [serviceCities, setServiceCities] = useState(initial.serviceCities.join(', '));
  const [minOrder, setMinOrder] = useState(initial.minOrderKzt?.toString() ?? '');
  const [leadTime, setLeadTime] = useState(initial.leadTimeDaysDefault?.toString() ?? '');
  const [portfolio, setPortfolio] = useState(initial.portfolioUrls.join('\n'));
  const [notes, setNotes] = useState(initial.notes);
  const { run, pending, error } = useAsyncAction(updateSupplierProfile, () => router.refresh());

  function submit() {
    const split = (value: string) => [
      ...new Set(
        value
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean),
      ),
    ];
    run({
      categories: split(categories),
      capabilities: split(capabilities),
      serviceCities: split(serviceCities),
      minOrderKzt: minOrder.trim() ? Number(minOrder) : null,
      leadTimeDaysDefault: leadTime.trim() ? Number(leadTime) : null,
      portfolioUrls: portfolio
        .split(/\r?\n/)
        .map((url) => url.trim())
        .filter(Boolean),
      notes,
    });
  }

  return (
    <div className="mt-5 flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-fine text-muted">
          Категории
          <input
            value={categories}
            onChange={(event) => setCategories(event.target.value)}
            disabled={!canManage}
            className={inputClass}
            placeholder="merch, printing"
          />
        </label>
        <label className="text-fine text-muted">
          Возможности / техпроцессы
          <input
            value={capabilities}
            onChange={(event) => setCapabilities(event.target.value)}
            disabled={!canManage}
            className={inputClass}
            placeholder="screen-print, embroidery"
          />
        </label>
        <label className="text-fine text-muted sm:col-span-2">
          Города обслуживания
          <input
            value={serviceCities}
            onChange={(event) => setServiceCities(event.target.value)}
            disabled={!canManage}
            className={inputClass}
            placeholder="Алматы, Астана"
          />
          <span className="mt-1 block text-micro text-muted">
            Укажите города через запятую. Пустой список означает доставку в любой город.
          </span>
        </label>
        <label className="text-fine text-muted">
          Минимальный заказ, ₸
          <input
            type="number"
            min={0}
            value={minOrder}
            onChange={(event) => setMinOrder(event.target.value)}
            disabled={!canManage}
            className={inputClass}
          />
        </label>
        <label className="text-fine text-muted">
          Типовой срок, дней
          <input
            type="number"
            min={1}
            value={leadTime}
            onChange={(event) => setLeadTime(event.target.value)}
            disabled={!canManage}
            className={inputClass}
          />
        </label>
      </div>
      <label className="text-fine text-muted">
        Портфолио — по одной HTTPS-ссылке на строку
        <textarea
          value={portfolio}
          onChange={(event) => setPortfolio(event.target.value)}
          disabled={!canManage}
          rows={3}
          className={inputClass}
        />
      </label>
      <label className="text-fine text-muted">
        Примечание для команды QAJET
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          disabled={!canManage}
          rows={4}
          maxLength={2000}
          className={inputClass}
        />
      </label>
      {canManage ? (
        <Button className="self-start" loading={pending} onClick={submit}>
          {pending ? 'Сохраняю…' : 'Сохранить профиль'}
        </Button>
      ) : (
        <p className="text-fine text-muted">Изменять профиль может только owner компании.</p>
      )}
      {error && <p className="text-fine text-signal">{error}</p>}
    </div>
  );
}
