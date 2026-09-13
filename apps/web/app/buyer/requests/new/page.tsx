'use client';

import type { ParsedRequestDraft } from '@qajet/engine/intake';
import { useAsyncAction } from '@qajet/ui/hooks';
import { Reveal, Stagger } from '@qajet/ui/motion';
import { Button, Card } from '@qajet/ui/primitives';
import Link from 'next/link';
import { useState } from 'react';
import { parseRequestTextAction } from '../../../lib/actions/intake-actions';
import { createRequest } from '../../../lib/actions/request-actions';
import { CATALOG, CATEGORY_LABEL, type CatalogCategory } from '../../../lib/catalog';
import { AttachmentForm } from '../../messages/_attachment-form';

/**
 * Мастер новой заявки — agents.md §10 «Покупатель». Реальная форма:
 * пишет requests+request_items (apps/web/app/lib/actions/request-actions.ts),
 * не мок. Позиции по-прежнему пишутся только из фиксированного каталога
 * (apps/web/app/lib/catalog.ts) — это осознанно, RFQ подбирает поставщиков
 * по requiredCapabilities каталожной позиции, свободный текст в базу не
 * попадает никогда. Но количество/срок/бюджет и сама позиция теперь можно
 * получить из свободного текста через @qajet/engine/intake (agents.md
 * §8A) — «Быстрое добавление» ниже: парсинг только ПРЕДЛАГАЕТ значения,
 * человек всегда видит и подтверждает результат перед добавлением строки.
 * Сам разбор теперь идёт через server action `parseRequestTextAction`
 * (lib/actions/intake-actions.ts) — ему нужен доступ к `extraction_aliases`
 * (волна 1, шаг 5), которого у клиента нет и не будет.
 */

const CATEGORIES: CatalogCategory[] = ['merch', 'corporate-gifts', 'printing'];

interface ItemRow {
  rowId: number;
  itemKey: string;
  qty: number;
  /** Исходная фраза быстрого разбора — только у строк, добавленных так. */
  sourceText?: string;
}

let nextRowId = 1;

const DEFAULT_CATALOG_ITEM = CATALOG[0];

function firstItemRow(): ItemRow {
  return {
    rowId: nextRowId++,
    itemKey: DEFAULT_CATALOG_ITEM.itemKey,
    qty: DEFAULT_CATALOG_ITEM.qtyMin,
  };
}

const inputClass =
  'w-full rounded-control border border-transparent bg-page px-4 py-3 text-sm text-ink placeholder:text-muted focus-visible:border-purple';

const secondaryLinkClass =
  'inline-flex h-10 items-center justify-center gap-2 rounded-control border border-rule bg-surface px-4 text-sm font-medium text-ink transition-colors duration-[var(--duration-instant)] hover:bg-page';

const NEXT_STEPS = [
  {
    title: 'Вы выбираете позиции и описываете задачу',
    sub: 'Каталог + свободное описание для консьержа',
  },
  {
    title: 'Консьерж берёт заявку в работу и оценивает её',
    sub: 'Реальный расчёт по истории цен, не догадка',
  },
  {
    title: 'QAJET запрашивает предложения у проверенных исполнителей',
    sub: 'Вы видите срок и решения по каждой позиции — без лишних деталей',
  },
  {
    title: 'Вы утверждаете план — с этого момента это заказ',
    sub: 'Полная декомпозиция суммы, без скрытых строк',
  },
];

export default function NewRequestPage() {
  const [title, setTitle] = useState('');
  const [city, setCity] = useState('Алматы');
  const [description, setDescription] = useState('');
  const [budget, setBudget] = useState('');
  const [deadlineDate, setDeadlineDate] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [items, setItems] = useState<ItemRow[]>([firstItemRow()]);
  const [createdRequestId, setCreatedRequestId] = useState<string | null>(null);
  const [quickText, setQuickText] = useState('');
  const [quickPreview, setQuickPreview] = useState<ParsedRequestDraft | null>(null);
  const [quickParsing, setQuickParsing] = useState(false);

  const { run, pending, error } = useAsyncAction(createRequest, (result) => {
    if (result.requestId) setCreatedRequestId(result.requestId);
  });

  function addItem() {
    setItems((prev) => [...prev, firstItemRow()]);
  }
  function removeItem(rowId: number) {
    setItems((prev) => (prev.length > 1 ? prev.filter((row) => row.rowId !== rowId) : prev));
  }
  function updateItem(rowId: number, patch: Partial<ItemRow>) {
    setItems((prev) => prev.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)));
  }

  async function handleQuickParse() {
    if (!quickText.trim() || quickParsing) return;
    setQuickParsing(true);
    try {
      setQuickPreview(await parseRequestTextAction(quickText));
    } finally {
      setQuickParsing(false);
    }
  }

  function acceptQuickPreview() {
    if (!quickPreview) return;
    const acceptedItems = quickPreview.items.flatMap((item) => {
      if (item.needsClarification || !item.itemKey || !item.quantity.value) return [];
      const catalogItem = CATALOG.find((c) => c.itemKey === item.itemKey);
      return catalogItem
        ? [{ catalogItem, qty: item.quantity.value.qty, sourceText: item.sourceText }]
        : [];
    });
    if (acceptedItems.length === 0) return;
    setItems((prev) => [
      ...prev,
      ...acceptedItems.map(({ catalogItem, qty, sourceText }) => ({
        rowId: nextRowId++,
        itemKey: catalogItem.itemKey,
        qty,
        sourceText,
      })),
    ]);
    if (quickPreview.deadline.value && !deadlineDate) setDeadlineDate(quickPreview.deadline.value);
    if (quickPreview.budget.value && !budget) setBudget(String(quickPreview.budget.value));
    if (quickPreview.deliveryAddress.value && !deliveryAddress)
      setDeliveryAddress(quickPreview.deliveryAddress.value);
    setQuickText('');
    setQuickPreview(null);
  }

  function dismissQuickPreview() {
    setQuickPreview(null);
  }

  function handleSubmit() {
    run({
      title,
      city,
      description,
      budgetKzt: budget ? Number(budget) : undefined,
      deadlineDate: deadlineDate || undefined,
      deliveryAddress: deliveryAddress || undefined,
      items: items.map((row) => ({
        itemKey: row.itemKey,
        qty: row.qty,
        sourceText: row.sourceText,
      })),
    });
  }

  if (createdRequestId) {
    return (
      <Reveal className="mx-auto max-w-xl py-20 text-center">
        <p className="text-4xl" aria-hidden="true">
          ✅
        </p>
        <h1 className="mt-4 text-2xl font-extrabold text-ink">Заявка отправлена</h1>
        <p className="mt-2 text-sm text-muted">
          Консьерж QAJET возьмёт её в работу и сделает оценку — заказ появится в «Мои заказы», как
          только это произойдёт.
        </p>
        <div className="mt-6 rounded-card border border-rule bg-surface text-left">
          <div className="px-6 py-4">
            <p className="text-sm font-semibold text-ink">Есть готовое ТЗ или брендбук?</p>
            <p className="mt-1 text-fine text-muted">
              Прикрепите его к заявке — файл останется приватным и будет доступен только участникам
              этого закупочного цикла.
            </p>
          </div>
          <AttachmentForm requestId={createdRequestId} returnPath="/buyer" kind="spec" />
        </div>
        <Link href="/buyer" className="mt-6 inline-block">
          <Button variant="primary">Вернуться на главную</Button>
        </Link>
      </Reveal>
    );
  }

  return (
    <div>
      <p className="mb-4 text-fine text-muted">
        <Link href="/buyer" className="hover:text-ink">
          Заказы
        </Link>
        <span className="mx-1.5">›</span>
        <span className="font-medium text-ink">Новая заявка</span>
      </p>

      <Reveal className="mb-7">
        <h1 className="text-3xl font-extrabold">Новая заявка</h1>
        <p className="mt-2 text-sm text-muted">
          Выберите позиции и опишите задачу — консьерж оценит стоимость и подберёт поставщиков.
        </p>
      </Reveal>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_340px]">
        <Reveal delay={0.06}>
          <Card className="p-7">
            <h3 className="text-lg font-bold">Расскажите о задаче</h3>
            <p className="mt-1.5 mb-5 text-fine text-muted">
              Название и позиции обязательны, остальное поможет консьержу точнее оценить сроки.
            </p>

            <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field id="request-title" label="Название заявки" required>
                <input
                  id="request-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Например, корпоративные подарки на Наурыз"
                  className={inputClass}
                />
              </Field>
              <Field id="request-city" label="Город доставки" required>
                <select
                  id="request-city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className={inputClass}
                >
                  <option>Алматы</option>
                  <option>Астана</option>
                  <option>Шымкент</option>
                </select>
              </Field>
            </div>

            <div className="mb-4">
              <Field id="request-description" label="Описание заявки">
                <textarea
                  id="request-description"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Для кого, к какому событию, особые пожелания…"
                  className={`${inputClass} resize-none`}
                />
              </Field>
            </div>

            <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field id="request-budget" label="Бюджет, ориентировочно">
                <input
                  id="request-budget"
                  type="number"
                  min={0}
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="1 200 000"
                  className={inputClass}
                />
              </Field>
              <Field id="request-date" label="Нужна дата доставки">
                <input
                  id="request-date"
                  type="date"
                  value={deadlineDate}
                  onChange={(e) => setDeadlineDate(e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field id="request-address" label="Адрес доставки">
                <input
                  id="request-address"
                  type="text"
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                  placeholder="Офис, склад…"
                  className={inputClass}
                />
              </Field>
            </div>

            <div className="mb-6">
              <p className="mb-2 text-fine font-semibold">Быстрое добавление из текста</p>
              <div className="flex flex-col gap-2 rounded-control border border-rule bg-page p-3 sm:flex-row">
                <input
                  type="text"
                  value={quickText}
                  onChange={(e) => setQuickText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleQuickParse();
                    }
                  }}
                  placeholder="Например: 100 футболок с логотипом до 15 октября"
                  className={`${inputClass} bg-surface sm:flex-1`}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  loading={quickParsing}
                  onClick={handleQuickParse}
                >
                  Разобрать
                </Button>
              </div>
              {quickPreview && (
                <div className="mt-2 rounded-control border border-purple/40 bg-purple-10 p-3 text-fine">
                  <p className="font-semibold text-ink">Предпросмотр заявки</p>
                  <ul className="mt-2 flex flex-col gap-1 text-muted">
                    {quickPreview.items.map((item, index) => (
                      <li key={`${item.sourceText}-${index}`}>
                        {item.itemLabel ? `«${item.itemLabel}»` : 'Позиция не распознана'} ·{' '}
                        {item.quantity.value
                          ? `${item.quantity.value.qty} ${item.unit ?? ''}`
                          : 'количество не распознано'}{' '}
                        {item.needsClarification && (
                          <span className="text-danger">— нужно уточнение</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-muted">
                    Срок: {quickPreview.deadline.value ?? 'не распознан'} · Бюджет:{' '}
                    {quickPreview.budget.value
                      ? `${quickPreview.budget.value.toLocaleString('ru-RU')} ₸`
                      : 'не распознан'}
                    {quickPreview.deliveryAddress.value
                      ? ` · ${quickPreview.deliveryAddress.value}`
                      : ''}
                  </p>
                  {quickPreview.needsClarification && (
                    <p className="mt-2 text-danger">
                      {quickPreview.clarificationReasons[0] ??
                        'Часть полей нужно уточнить вручную. Неполные строки не будут добавлены.'}
                    </p>
                  )}
                  <div className="mt-2 flex gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={acceptQuickPreview}
                      disabled={quickPreview.items.every(
                        (item) => item.needsClarification || !item.itemKey || !item.quantity.value,
                      )}
                    >
                      Добавить
                    </Button>
                    <Button variant="secondary" size="sm" onClick={dismissQuickPreview}>
                      Не добавлять
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="mb-6">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-fine font-semibold">Позиции *</p>
                <Button variant="secondary" size="sm" onClick={addItem}>
                  + Добавить позицию
                </Button>
              </div>
              <div className="flex flex-col gap-3">
                {items.map((row) => {
                  const catalogItem =
                    CATALOG.find((c) => c.itemKey === row.itemKey) ?? DEFAULT_CATALOG_ITEM;
                  return (
                    <div
                      key={row.rowId}
                      className="grid grid-cols-1 items-end gap-3 rounded-control border border-rule bg-page p-3 sm:grid-cols-[1fr_140px_auto]"
                    >
                      <label className="block">
                        <span className="mb-1 block text-micro font-semibold text-muted">
                          Позиция
                        </span>
                        <select
                          value={row.itemKey}
                          onChange={(e) => {
                            const next = CATALOG.find((c) => c.itemKey === e.target.value);
                            if (next)
                              updateItem(row.rowId, { itemKey: next.itemKey, qty: next.qtyMin });
                          }}
                          className={inputClass}
                        >
                          {CATEGORIES.map((category) => (
                            <optgroup key={category} label={CATEGORY_LABEL[category]}>
                              {CATALOG.filter((c) => c.category === category).map((c) => (
                                <option key={c.itemKey} value={c.itemKey}>
                                  {c.name}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-micro font-semibold text-muted">
                          Кол-во, {catalogItem.unit}
                        </span>
                        <input
                          type="number"
                          min={catalogItem.qtyMin}
                          max={catalogItem.qtyMax}
                          value={row.qty}
                          onChange={(e) => updateItem(row.rowId, { qty: Number(e.target.value) })}
                          className={inputClass}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => removeItem(row.rowId)}
                        disabled={items.length === 1}
                        className="h-[46px] rounded-control border border-rule px-3 text-fine text-muted transition-colors duration-[var(--duration-instant)] hover:bg-surface disabled:opacity-40"
                      >
                        Убрать
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <Link href="/buyer" className={secondaryLinkClass}>
                Отмена
              </Link>
              <Button variant="primary" loading={pending} onClick={handleSubmit}>
                {pending ? 'Отправляю…' : 'Отправить заявку'}
              </Button>
            </div>
            {error && <p className="mt-3 text-fine text-signal">{error}</p>}
          </Card>
        </Reveal>

        <Stagger className="flex flex-col gap-4" as="div">
          {[
            <Card key="summary" padding="sm">
              <h3 className="mb-4 text-sm font-semibold">Кратко о заявке</h3>
              <dl className="flex flex-col gap-2.5 text-fine">
                <div className="flex justify-between border-t border-rule pt-2.5">
                  <dt className="text-muted">Позиций</dt>
                  <dd className="font-semibold">{items.length}</dd>
                </div>
                <div className="flex justify-between border-t border-rule pt-2.5">
                  <dt className="text-muted">Город доставки</dt>
                  <dd className="font-semibold">{city}</dd>
                </div>
                <div className="flex justify-between border-t border-rule pt-2.5">
                  <dt className="text-muted">Планируемая дата</dt>
                  <dd className="font-semibold text-muted">{deadlineDate || 'Не указана'}</dd>
                </div>
                <div className="flex justify-between border-t border-rule pt-2.5">
                  <dt className="text-muted">Бюджет</dt>
                  <dd className="font-semibold text-muted">
                    {budget ? `${budget} ₸` : 'Не указан'}
                  </dd>
                </div>
              </dl>
            </Card>,
            <div key="next" className="rounded-card border border-rule bg-surface p-5">
              <h3 className="mb-4 text-sm font-semibold">Что дальше?</h3>
              <div className="flex flex-col gap-4">
                {NEXT_STEPS.map((step, i) => (
                  <div key={step.title} className="flex gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-page text-micro font-semibold text-muted">
                      {i + 1}
                    </div>
                    <div>
                      <p className="text-fine font-semibold">{step.title}</p>
                      <p className="text-micro text-muted">{step.sub}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>,
          ]}
        </Stagger>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  required,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="block">
      <label htmlFor={id} className="mb-2 block text-fine font-semibold">
        {label}
        {required && <span className="text-muted"> *</span>}
      </label>
      {children}
    </div>
  );
}
