'use client';

import {
  type CatalogEntry,
  extractBudget,
  extractDeadline,
  extractQuantity,
  matchNomenclature,
} from '@qajet/engine/intake';
import { useAsyncAction } from '@qajet/ui/hooks';
import { Reveal, Stagger } from '@qajet/ui/motion';
import { Button, Card } from '@qajet/ui/primitives';
import Link from 'next/link';
import { useState } from 'react';
import { createRequest } from '../../../lib/actions/request-actions';
import { CATALOG, CATEGORY_LABEL, type CatalogCategory } from '../../../lib/catalog';

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
 */

const CATALOG_ENTRIES: CatalogEntry[] = CATALOG.map((c) => ({ key: c.itemKey, label: c.name }));

interface QuickParsePreview {
  itemKey: string | null;
  itemLabel: string | null;
  itemConfidence: number;
  qty: number | null;
  deadline: string | null;
  budget: number | null;
}

// matchNomenclature (agents.md §8A) сравнивает строку целиком с коротким
// каталожным названием — «120 футболок с логотипом до 20 октября» против
// «Футболка с логотипом» триграммами/Дамерау-Левенштейном даёт заведомо
// заниженное сходство просто из-за длины строки, а не из-за реального
// несовпадения позиции. Убираем количество/срок/валюту перед сравнением
// номенклатуры — сам движок не трогаем, это исключительно подготовка
// текста для одного конкретного вызова здесь.
// Не \b: в JS-регулярках без юникодных классов Cyrillic не входит в \w,
// поэтому \b вокруг кириллических слов не срабатывает вовсе (граница
// требует, чтобы хотя бы одна сторона была \w). Явные lookaround вместо.
const NOISE_RE =
  /(?<![a-zа-яё])(\d[\d\s]*|шт\.?|штук|коробок|уп\.?|упаковок|компл\.?|комплектов|пар|наборов|до|к|через|дн(?:ей|я|ь)|недел[юия]|месяц[аеы]?|млн|тг|тенге|₸|января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?![a-zа-яё])/gi;

function stripNoiseForMatching(text: string): string {
  const stripped = text.replace(NOISE_RE, ' ').replace(/\s+/g, ' ').trim();
  return stripped || text;
}

function parseQuickText(text: string): QuickParsePreview {
  const nomenclature = matchNomenclature(stripNoiseForMatching(text), CATALOG_ENTRIES);
  const quantity = extractQuantity(text);
  const deadline = extractDeadline(text, new Date());
  const budget = extractBudget(text);
  // Ниже порога уверенности (agents.md §8A) — не подставляем молча, даже
  // если matchNomenclature вернул лучший кандидат: needsClarification уже
  // несёт этот сигнал, используем его, а не игнорируем ради удобства.
  const matchedItem =
    nomenclature.value && !nomenclature.needsClarification
      ? CATALOG.find((c) => c.itemKey === nomenclature.value)
      : null;
  return {
    itemKey: matchedItem?.itemKey ?? null,
    itemLabel: matchedItem?.name ?? null,
    itemConfidence: nomenclature.confidence,
    qty: quantity.value?.qty ?? null,
    deadline: deadline.value,
    budget: budget.value,
  };
}

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
    sub: 'Каталог + свободное описание для концьержа',
  },
  {
    title: 'Концьерж берёт заявку в работу и оценивает её',
    sub: 'Реальный расчёт по истории цен, не догадка',
  },
  {
    title: 'Мы рассылаем RFQ проверенным поставщикам',
    sub: 'Видно, кому и почему выбран каждый поставщик',
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
  const [quickPreview, setQuickPreview] = useState<QuickParsePreview | null>(null);

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

  function handleQuickParse() {
    if (!quickText.trim()) return;
    setQuickPreview(parseQuickText(quickText));
  }

  function acceptQuickPreview() {
    if (!quickPreview) return;
    const catalogItem = quickPreview.itemKey
      ? (CATALOG.find((c) => c.itemKey === quickPreview.itemKey) ?? DEFAULT_CATALOG_ITEM)
      : DEFAULT_CATALOG_ITEM;
    const qty = quickPreview.qty
      ? Math.min(Math.max(quickPreview.qty, catalogItem.qtyMin), catalogItem.qtyMax)
      : catalogItem.qtyMin;
    setItems((prev) => [
      ...prev,
      { rowId: nextRowId++, itemKey: catalogItem.itemKey, qty, sourceText: quickText },
    ]);
    if (quickPreview.deadline && !deadlineDate) setDeadlineDate(quickPreview.deadline);
    if (quickPreview.budget && !budget) setBudget(String(quickPreview.budget));
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
          Концьерж QAJET возьмёт её в работу и сделает оценку — заказ появится в «Мои заказы», как
          только это произойдёт.
        </p>
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
          Выберите позиции и опишите задачу — концьерж оценит стоимость и подберёт поставщиков.
        </p>
      </Reveal>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_340px]">
        <Reveal delay={0.06}>
          <Card className="p-7">
            <h3 className="text-lg font-bold">Расскажите о задаче</h3>
            <p className="mt-1.5 mb-5 text-fine text-muted">
              Название и позиции обязательны, остальное поможет концьержу точнее оценить сроки.
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
                <Button variant="secondary" size="sm" onClick={handleQuickParse}>
                  Разобрать
                </Button>
              </div>
              {quickPreview && (
                <div className="mt-2 rounded-control border border-purple/40 bg-purple-10 p-3 text-fine">
                  <p className="font-semibold text-ink">
                    {quickPreview.itemLabel ? (
                      <>
                        Похоже на «{quickPreview.itemLabel}»{' '}
                        <span className="font-normal text-muted">
                          ({Math.round(quickPreview.itemConfidence * 100)}% совпадение)
                        </span>
                      </>
                    ) : (
                      <span className="text-muted">
                        Не удалось уверенно распознать позицию — будет добавлена первая позиция
                        каталога, поправьте вручную
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-muted">
                    Количество: {quickPreview.qty ?? 'не распознано'} · Срок:{' '}
                    {quickPreview.deadline ?? 'не распознан'} · Бюджет:{' '}
                    {quickPreview.budget
                      ? `${quickPreview.budget.toLocaleString('ru-RU')} ₸`
                      : 'не распознан'}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button variant="primary" size="sm" onClick={acceptQuickPreview}>
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
