'use client';

import { Reveal, Stagger } from '@qajet/ui/motion';
import { Button, Card } from '@qajet/ui/primitives';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import {
  parseRequestTextAction,
  type RequestDraftPreview,
} from '../../../lib/actions/intake-actions';
import { createRequest } from '../../../lib/actions/request-actions';
import { CATALOG, CATEGORY_LABEL, type CatalogCategory } from '../../../lib/catalog';
import {
  firstFieldWithError,
  type RequestField,
  type RequestFieldErrors,
} from '../../../lib/request-validation';

/**
 * Мастер новой заявки — qajet-master-spec.md §10 «Покупатель». Реальная форма:
 * пишет requests+request_items (apps/web/app/lib/actions/request-actions.ts).
 * Позиции пишутся только из фиксированного каталога — RFQ подбирает
 * поставщиков по requiredCapabilities каталожной позиции, свободный текст в
 * базу как позиция не попадает. Количество, срок и бюджет можно получить из
 * текста (@qajet/engine/intake, §8A): разбор только ПРЕДЛАГАЕТ, человек видит
 * и подтверждает результат перед добавлением строки.
 *
 * Поведение, которое здесь важно для человека:
 *  - список позиций начинается пустым: раньше в нём была неудаляемая
 *    «Футболка × 50», которая молча уходила в заявку, если её не заметить;
 *  - форма — настоящий <form>, Enter в поле отправляет её;
 *  - ошибки стоят рядом с полем, поле помечено aria-invalid, фокус уходит на
 *    первое из них;
 *  - повторная отправка (двойной клик, повтор после обрыва сети) не создаёт
 *    вторую заявку: `submissionKey` создаётся один раз при открытии формы, а
 *    база возвращает уже созданную заявку;
 *  - после отправки покупатель попадает на страницу своей заявки.
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

function newItemRow(): ItemRow {
  return {
    rowId: nextRowId++,
    itemKey: DEFAULT_CATALOG_ITEM.itemKey,
    qty: DEFAULT_CATALOG_ITEM.qtyMin,
  };
}

const inputClass =
  'w-full rounded-control border border-transparent bg-page px-4 py-3 text-sm text-ink placeholder:text-muted focus-visible:border-purple aria-[invalid=true]:border-danger';

const secondaryLinkClass =
  'inline-flex h-10 items-center justify-center gap-2 rounded-control border border-rule bg-surface px-4 text-sm font-medium text-ink transition-colors duration-[var(--duration-instant)] hover:bg-page';

/** id поля, на которое уходит фокус при ошибке. */
const FIELD_ID: Record<RequestField, string> = {
  title: 'request-title',
  city: 'request-city',
  items: 'request-items',
  deadlineDate: 'request-date',
  budgetKzt: 'request-budget',
  deliveryAddress: 'request-address',
  description: 'request-description',
};

const NEXT_STEPS = [
  {
    title: 'Вы описываете задачу и выбираете позиции',
    sub: 'Можно вставить текст — мы разберём его, вы подтвердите',
  },
  {
    title: 'Консьерж берёт заявку в работу и оценивает её',
    sub: 'Реальный расчёт по истории цен, не догадка',
  },
  {
    title: 'QAJET собирает предложения исполнителей',
    sub: 'Вы видите срок и решения по каждой позиции — без лишних деталей',
  },
  {
    title: 'Вы утверждаете план — с этого момента это заказ',
    sub: 'Полная декомпозиция суммы, без скрытых строк',
  },
];

export default function NewRequestPage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [city, setCity] = useState('Алматы');
  const [description, setDescription] = useState('');
  const [budget, setBudget] = useState('');
  const [deadlineDate, setDeadlineDate] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [items, setItems] = useState<ItemRow[]>([]);
  const [quickText, setQuickText] = useState('');
  const [quickPreview, setQuickPreview] = useState<RequestDraftPreview | null>(null);
  const [quickParsing, setQuickParsing] = useState(false);
  const [quickNothing, setQuickNothing] = useState(false);

  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<RequestFieldErrors>({});
  // Один ключ на всё время жизни формы: повтор отправки вернёт ту же заявку.
  const [submissionKey] = useState(() => crypto.randomUUID());
  const today = new Date().toISOString().slice(0, 10);

  function clearFieldError(field: RequestField) {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const { [field]: _removed, ...rest } = prev;
      return rest;
    });
  }

  function fieldProps(field: RequestField) {
    const message = fieldErrors[field];
    return {
      id: FIELD_ID[field],
      'aria-invalid': message ? (true as const) : undefined,
      'aria-describedby': message ? `${FIELD_ID[field]}-error` : undefined,
    };
  }

  function addItem() {
    setItems((prev) => [...prev, newItemRow()]);
    clearFieldError('items');
  }
  function removeItem(rowId: number) {
    setItems((prev) => prev.filter((row) => row.rowId !== rowId));
  }
  function updateItem(rowId: number, patch: Partial<ItemRow>) {
    setItems((prev) => prev.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)));
  }

  async function handleQuickParse() {
    if (!quickText.trim() || quickParsing) return;
    setQuickParsing(true);
    setQuickNothing(false);
    try {
      const draft = await parseRequestTextAction(quickText);
      setQuickPreview(draft);
      setQuickNothing(draft.items.length === 0);
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
    clearFieldError('items');
    if (quickPreview.deadline.value && !deadlineDate) setDeadlineDate(quickPreview.deadline.value);
    if (quickPreview.budget.value && !budget) setBudget(String(quickPreview.budget.value));
    if (quickPreview.deliveryAddress.value && !deliveryAddress)
      setDeliveryAddress(quickPreview.deliveryAddress.value);
    setQuickText('');
    setQuickPreview(null);
  }

  function dismissQuickPreview() {
    setQuickPreview(null);
    setQuickNothing(false);
  }

  function focusField(field: RequestField) {
    // Дожидаемся перерисовки: атрибуты aria-invalid и текст ошибки уже в DOM.
    requestAnimationFrame(() => document.getElementById(FIELD_ID[field])?.focus());
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Ref, а не state: второй клик до перерисовки видит уже занятую отправку.
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      const result = await createRequest({
        title,
        city,
        description,
        budgetKzt: budget ? Number(budget) : undefined,
        deadlineDate: deadlineDate || undefined,
        deliveryAddress: deliveryAddress || undefined,
        submissionKey,
        items: items.map((row) => ({
          itemKey: row.itemKey,
          qty: row.qty,
          sourceText: row.sourceText,
        })),
      });
      if (result.ok && result.requestId) {
        // Кнопка остаётся заблокированной: до перехода вторая отправка не нужна.
        router.push(`/buyer/requests/${result.requestId}`);
        return;
      }
      const errors = (result.fieldErrors ?? {}) as RequestFieldErrors;
      setFieldErrors(errors);
      setError(result.error ?? 'Не удалось отправить заявку');
      const first = firstFieldWithError(errors);
      if (first) focusField(first);
      submitting.current = false;
      setPending(false);
    } catch {
      setError('Не удалось отправить заявку. Проверьте соединение и повторите.');
      submitting.current = false;
      setPending(false);
    }
  }

  const hasItems = items.length > 0;

  return (
    <div>
      <p className="mb-4 text-fine text-muted">
        <Link href="/buyer" className="hover:text-ink">
          Закупки
        </Link>
        <span className="mx-1.5">›</span>
        <span className="font-medium text-ink">Новая заявка</span>
      </p>

      <Reveal className="mb-7">
        <h1 className="text-3xl font-extrabold">Новая заявка</h1>
        <p className="mt-2 text-sm text-muted">
          Опишите задачу и добавьте позиции — консьерж оценит стоимость и подберёт исполнителей.
        </p>
      </Reveal>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_340px]">
        <Reveal delay={0.06}>
          <Card className="p-7">
            <form onSubmit={handleSubmit} noValidate>
              <h3 className="text-lg font-bold">Расскажите о задаче</h3>
              <p className="mt-1.5 mb-5 text-fine text-muted">
                Начните с описания своими словами. Название, город и хотя бы одна позиция
                обязательны — остальное поможет точнее оценить сроки.
              </p>

              <div className="mb-3 rounded-control border border-rule bg-page p-3">
                <label htmlFor="request-quick-text" className="mb-1 block text-sm font-bold">
                  Что нужно закупить?
                </label>
                <p className="mb-2 text-fine text-muted">
                  Напишите своими словами — что, сколько и к какому сроку. Поля ниже заполнятся
                  сами, и их можно поправить.
                </p>
                <div className="flex flex-col gap-2">
                  <textarea
                    id="request-quick-text"
                    rows={3}
                    value={quickText}
                    onChange={(e) => {
                      setQuickText(e.target.value);
                      setQuickNothing(false);
                    }}
                    onKeyDown={(e) => {
                      // Разбор по Ctrl+Enter. Обычный Enter переносит строку: заявку
                      // на несколько позиций пишут в столбик, и разбор по Enter
                      // обрывал бы её на первой.
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        handleQuickParse();
                      }
                    }}
                    placeholder="300 welcome-наборов до 20 октября, бюджет 3 млн ₸"
                    className={`${inputClass} resize-none bg-surface`}
                  />
                  <div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      loading={quickParsing}
                      onClick={handleQuickParse}
                    >
                      Разобрать
                    </Button>
                  </div>
                </div>
                {quickNothing && (
                  <p className="mt-2 text-fine text-muted">
                    Не нашли позиций в этом тексте. Попробуйте указать товар и количество или
                    добавьте позицию вручную из каталога.
                  </p>
                )}
                {quickPreview && !quickNothing && (
                  <div className="mt-2 rounded-control border border-purple/40 bg-purple-10 p-3 text-fine">
                    <p className="font-semibold text-ink">Что мы поняли</p>
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
                          {quickPreview.categoryHints[index] && (
                            <span className="block text-micro">
                              Такую фразу уже не раз относили к категории «
                              {quickPreview.categoryHints[index]?.label}».
                            </span>
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
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={acceptQuickPreview}
                        disabled={quickPreview.items.every(
                          (item) =>
                            item.needsClarification || !item.itemKey || !item.quantity.value,
                        )}
                      >
                        Добавить в заявку
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={dismissQuickPreview}
                      >
                        Не добавлять
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  id={FIELD_ID.title}
                  label="Название заявки"
                  required
                  error={fieldErrors.title}
                >
                  <input
                    {...fieldProps('title')}
                    type="text"
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      clearFieldError('title');
                    }}
                    placeholder="Например, корпоративные подарки на Наурыз"
                    className={inputClass}
                  />
                </Field>
                <Field id={FIELD_ID.city} label="Город доставки" required error={fieldErrors.city}>
                  <select
                    {...fieldProps('city')}
                    value={city}
                    onChange={(e) => {
                      setCity(e.target.value);
                      clearFieldError('city');
                    }}
                    className={inputClass}
                  >
                    <option>Алматы</option>
                    <option>Астана</option>
                    <option>Шымкент</option>
                  </select>
                </Field>
              </div>

              <div className="mb-4">
                <Field
                  id={FIELD_ID.description}
                  label="Описание заявки"
                  error={fieldErrors.description}
                >
                  <textarea
                    {...fieldProps('description')}
                    rows={3}
                    value={description}
                    onChange={(e) => {
                      setDescription(e.target.value);
                      clearFieldError('description');
                    }}
                    placeholder="Для кого, к какому событию, особые пожелания…"
                    className={`${inputClass} resize-none`}
                  />
                </Field>
              </div>

              <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field
                  id={FIELD_ID.budgetKzt}
                  label="Бюджет, ориентировочно"
                  error={fieldErrors.budgetKzt}
                >
                  <input
                    {...fieldProps('budgetKzt')}
                    type="number"
                    min={0}
                    value={budget}
                    onChange={(e) => {
                      setBudget(e.target.value);
                      clearFieldError('budgetKzt');
                    }}
                    placeholder="1 200 000"
                    className={inputClass}
                  />
                </Field>
                <Field
                  id={FIELD_ID.deadlineDate}
                  label="Нужна дата доставки"
                  error={fieldErrors.deadlineDate}
                >
                  <input
                    {...fieldProps('deadlineDate')}
                    type="date"
                    min={today}
                    value={deadlineDate}
                    onChange={(e) => {
                      setDeadlineDate(e.target.value);
                      clearFieldError('deadlineDate');
                    }}
                    className={inputClass}
                  />
                </Field>
                <Field
                  id={FIELD_ID.deliveryAddress}
                  label="Адрес доставки"
                  error={fieldErrors.deliveryAddress}
                >
                  <input
                    {...fieldProps('deliveryAddress')}
                    type="text"
                    value={deliveryAddress}
                    onChange={(e) => {
                      setDeliveryAddress(e.target.value);
                      clearFieldError('deliveryAddress');
                    }}
                    placeholder="Офис, склад…"
                    className={inputClass}
                  />
                </Field>
              </div>

              <fieldset
                id={FIELD_ID.items}
                tabIndex={-1}
                aria-invalid={fieldErrors.items ? true : undefined}
                aria-describedby={fieldErrors.items ? `${FIELD_ID.items}-error` : undefined}
                className="mb-6 min-w-0 border-0 p-0 focus-visible:outline-none"
              >
                <legend className="mb-2 p-0 text-fine font-semibold">
                  Позиции <span className="text-muted">*</span>
                </legend>

                {hasItems ? (
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
                                  updateItem(row.rowId, {
                                    itemKey: next.itemKey,
                                    qty: next.qtyMin,
                                  });
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
                              onChange={(e) =>
                                updateItem(row.rowId, { qty: Number(e.target.value) })
                              }
                              className={inputClass}
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => removeItem(row.rowId)}
                            className="h-[46px] rounded-control border border-rule px-3 text-fine text-muted transition-colors duration-[var(--duration-instant)] hover:bg-surface"
                          >
                            Убрать
                          </button>
                        </div>
                      );
                    })}
                    <div>
                      <Button type="button" variant="secondary" size="sm" onClick={addItem}>
                        + Ещё позиция из каталога
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-start gap-2 rounded-control border border-dashed border-rule p-4">
                    <p className="text-fine text-muted">Позиций пока нет.</p>
                    <Button type="button" variant="secondary" size="sm" onClick={addItem}>
                      Добавить позицию из каталога
                    </Button>
                  </div>
                )}
                {fieldErrors.items && (
                  <p id={`${FIELD_ID.items}-error`} className="mt-2 text-fine text-danger">
                    {fieldErrors.items}
                  </p>
                )}
              </fieldset>

              <div className="flex items-center justify-between">
                <Link href="/buyer" className={secondaryLinkClass}>
                  Отмена
                </Link>
                <Button type="submit" variant="primary" loading={pending}>
                  {pending ? 'Отправляю…' : 'Отправить заявку'}
                </Button>
              </div>
              {error && (
                <p role="alert" className="mt-3 text-fine text-danger">
                  {error}
                </p>
              )}
            </form>
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
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="block">
      <label htmlFor={id} className="mb-2 block text-fine font-semibold">
        {label}
        {required && <span className="text-muted"> *</span>}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-fine text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
