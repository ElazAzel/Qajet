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

const warningId = (itemId: string) => `capability-warning-${itemId}`;
const fieldErrorId = (itemId: string) => `line-error-${itemId}`;

/**
 * Ошибка строки, которую видно по черновику без сервера. Поле, оставленное пустым,
 * — не ошибка (позиция просто без цены); введённый ноль или дробь — ошибка, и о
 * ней сказано прямо, а не общим «укажите цену» (аудит F2).
 */
function lineError(draft: LineDraft | undefined): string | null {
  if (!draft) return null;
  const positiveInteger = (value: string) => {
    const n = Number(value);
    return Number.isSafeInteger(n) && n > 0;
  };
  if (draft.unitPriceKzt !== '' && !positiveInteger(draft.unitPriceKzt)) {
    return 'Цена должна быть больше нуля и в целых тенге';
  }
  if (draft.leadTimeDays !== '' && !positiveInteger(draft.leadTimeDays)) {
    return 'Срок должен быть целым числом дней больше нуля';
  }
  if (draft.unitPriceKzt !== '' && draft.leadTimeDays === '') {
    return 'Укажите срок поставки для этой позиции';
  }
  if (draft.unitPriceKzt === '' && draft.leadTimeDays !== '') {
    return 'Укажите цену для этой позиции';
  }
  return null;
}

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
  const [warned, setWarned] = useState(false);
  // Ошибки проверяются вычислением по текущему черновику, а показываются после
  // первой попытки: исправленное поле убирает сообщение сразу (аудит F2).
  const [attempted, setAttempted] = useState(false);
  // Ответ сервера относится к отправленному черновику: любая правка его снимает.
  const [serverErrorStale, setServerErrorStale] = useState(false);

  const { run, pending, error } = useAsyncAction(submitQuote, () => {
    router.push(`/supplier?sent=${encodeURIComponent(rfqId)}`);
  });

  function patch(itemId: string, field: keyof LineDraft, value: string | boolean) {
    setServerErrorStale(true);
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

  /**
   * Одно определение «позиция заполнена» на предупреждение и на отправку: если
   * развести их, форма предупредит об одном, а отправит другое.
   */
  function lineFor(item: RequestItemRow) {
    const draft = drafts[item.id];
    const unitPriceKzt = Number(draft?.unitPriceKzt);
    const leadTimeDays = Number(draft?.leadTimeDays);
    if (!draft || lineError(draft) || !unitPriceKzt || !leadTimeDays) return null;
    return {
      requestItemId: item.id,
      unitPriceKzt,
      leadTimeDays,
      capabilityConfirmed: draft.capabilityConfirmed,
      setupFeeKzt: draft.setupFeeKzt ? Number(draft.setupFeeKzt) : undefined,
      minQty: draft.minQty ? Number(draft.minQty) : undefined,
    };
  }

  const lines = items
    .map(lineFor)
    .filter((line): line is NonNullable<ReturnType<typeof lineFor>> => line !== null);
  const unconfirmed = new Set(
    lines.filter((line) => !line.capabilityConfirmed).map((line) => line.requestItemId),
  );

  const lineErrors = new Map(
    items
      .map((item) => [item.id, lineError(drafts[item.id])] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== null),
  );
  const formError =
    lineErrors.size > 0
      ? 'Исправьте отмеченные позиции'
      : lines.length === 0
        ? 'Укажите цену хотя бы по одной позиции'
        : null;
  const visibleError = attempted ? formError : null;
  const visibleServerError = error && !serverErrorStale ? error : null;

  function handleSubmit() {
    setAttempted(true);
    if (formError) return;
    // Отправка без подтверждения разрешена (политику не меняем), но не молча:
    // первое нажатие показывает последствие, второе — отправляет. Аудит F1.
    if (unconfirmed.size > 0 && !warned) {
      setWarned(true);
      return;
    }
    setServerErrorStale(false);
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
                  min={1}
                  value={draft.unitPriceKzt}
                  aria-invalid={attempted && lineErrors.has(item.id) ? true : undefined}
                  aria-describedby={
                    attempted && lineErrors.has(item.id) ? fieldErrorId(item.id) : undefined
                  }
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
                  aria-invalid={attempted && lineErrors.has(item.id) ? true : undefined}
                  aria-describedby={
                    attempted && lineErrors.has(item.id) ? fieldErrorId(item.id) : undefined
                  }
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
            {attempted && lineErrors.has(item.id) && (
              <p id={fieldErrorId(item.id)} role="alert" className="mt-1.5 text-fine text-signal">
                {lineErrors.get(item.id)}
              </p>
            )}
            <label className="mt-3 flex items-start gap-2 text-fine text-muted">
              <input
                type="checkbox"
                checked={draft.capabilityConfirmed}
                onChange={(event) => patch(item.id, 'capabilityConfirmed', event.target.checked)}
                className="mt-0.5 accent-purple"
                aria-describedby={
                  warned && unconfirmed.has(item.id) ? warningId(item.id) : undefined
                }
              />
              <span>Подтверждаю, что могу исполнить эту позицию и указанные условия.</span>
            </label>
            {/* Предупреждение выводится ВЫЧИСЛЕНИЕМ, а не хранится: отметка убирает
                его сразу, без отдельной отправки формы (аудит F2). */}
            {warned && unconfirmed.has(item.id) && (
              <p id={warningId(item.id)} role="alert" className="mt-1.5 text-fine text-signal">
                Без этой отметки позиция не попадёт в сравнение — QAJET не сможет собрать по ней
                план и запросит у вас исправление.
              </p>
            )}
          </div>
        );
      })}

      {/* Сообщение стоит над кнопкой и в регионе alert: экранный читатель его
          объявит, а исправление формы убирает его без повторной отправки (F2). */}
      {(visibleError || visibleServerError) && (
        <p role="alert" className="text-fine text-signal">
          {visibleError ?? visibleServerError}
        </p>
      )}
      <div className="flex items-center justify-between">
        <p className="text-fine text-muted">
          Оставьте пустыми позиции, по которым не даёте цену. Незаполненные условия сохранятся как
          требующие уточнения. Отправляя КП, вы принимаете{' '}
          <a
            href="/terms/suppliers"
            target="_blank"
            rel="noreferrer"
            className="text-purple hover:underline"
          >
            условия для поставщиков
          </a>
          .
        </p>
        <Button variant="primary" loading={pending} onClick={handleSubmit}>
          {/* Второй кнопки не появляется: меняется подпись единственной главной. */}
          {pending
            ? 'Отправляю…'
            : warned && unconfirmed.size > 0
              ? 'Всё равно отправить без подтверждения'
              : revision
                ? 'Отправить исправленное КП'
                : 'Отправить КП'}
        </Button>
      </div>
    </div>
  );
}
