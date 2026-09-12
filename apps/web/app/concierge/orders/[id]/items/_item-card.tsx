'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { Stamp } from '@qajet/ui/motion';
import { Button, Card } from '@qajet/ui/primitives';
import { useState } from 'react';
import { correctItemClassification, splitRequestItem } from '../../../../lib/actions/item-actions';
import { CATALOG, CATEGORY_LABEL, type CatalogCategory } from '../../../../lib/catalog';

const inputClass =
  'w-full rounded-control border border-transparent bg-page px-3 py-2 text-fine text-ink focus-visible:border-purple';

export interface ItemCardData {
  id: string;
  name: string;
  category: string;
  qty: number;
  unit: string;
  requiredCapabilities: string[];
  itemKey?: string | undefined;
  sourceText?: string | undefined;
  needsClarification: boolean;
  clarificationReason: string | null;
}

interface SplitRow {
  key: number;
  name: string;
  qty: string;
}

let nextSplitRowKey = 1;

function evenSplitRows(item: ItemCardData): SplitRow[] {
  const half = Math.floor(item.qty / 2) || 1;
  return [
    { key: nextSplitRowKey++, name: item.name, qty: String(item.qty - half) },
    { key: nextSplitRowKey++, name: item.name, qty: String(half) },
  ];
}

/**
 * Карточка позиции заявки — просмотр + подтверждение каталожной позиции
 * (Classification Engine, agents.md §8A) + split (Dependency Engine,
 * шаг 7 волны — merge живёт на уровне списка, `_items-list.tsx`, потому
 * что объединяет несколько карточек сразу). Изменение категории и split
 * пишут на сервере (item-actions.ts) — карточка только собирает форму.
 */
export function ItemCard({
  item,
  editable,
  selectable,
  selected,
  onToggleSelect,
}: {
  item: ItemCardData;
  editable: boolean;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [itemKey, setItemKey] = useState(item.itemKey ?? '');
  const { run, pending, error } = useAsyncAction(correctItemClassification, () =>
    setEditing(false),
  );

  const [splitting, setSplitting] = useState(false);
  const [splitRows, setSplitRows] = useState<SplitRow[]>(() => evenSplitRows(item));
  const {
    run: runSplit,
    pending: splitPending,
    error: splitError,
  } = useAsyncAction(splitRequestItem, () => setSplitting(false));

  const categoryLabel = CATEGORY_LABEL[item.category as CatalogCategory] ?? item.category;

  function updateSplitRow(key: number, patch: Partial<SplitRow>) {
    setSplitRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }
  function addSplitRow() {
    setSplitRows((prev) => [...prev, { key: nextSplitRowKey++, name: item.name, qty: '1' }]);
  }
  function removeSplitRow(key: number) {
    setSplitRows((prev) => (prev.length > 2 ? prev.filter((row) => row.key !== key) : prev));
  }
  function submitSplit() {
    runSplit(
      item.id,
      splitRows.map((row) => ({ name: row.name.trim() || item.name, qty: Number(row.qty) })),
    );
  }

  return (
    <Card padding="sm">
      {editing ? (
        <div className="flex flex-col gap-2.5">
          <label className="block">
            <span className="mb-1 block text-micro font-semibold text-muted">
              Подтвердить позицию каталога
            </span>
            <select
              value={itemKey}
              onChange={(e) => setItemKey(e.target.value)}
              className={inputClass}
            >
              <option value="">Выберите позицию</option>
              {CATALOG.map((catalogItem) => (
                <option key={catalogItem.itemKey} value={catalogItem.itemKey}>
                  {catalogItem.name} · {CATEGORY_LABEL[catalogItem.category]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              loading={pending}
              disabled={!itemKey}
              onClick={() => run(item.id, { itemKey })}
            >
              Подтвердить
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
              Отмена
            </Button>
          </div>
          {error && <p className="text-fine text-signal">{error}</p>}
        </div>
      ) : splitting ? (
        <div className="flex flex-col gap-2.5">
          <p className="text-fine font-semibold text-ink">
            Разделить «{item.name}» ({item.qty} {item.unit})
          </p>
          {splitRows.map((row) => (
            <div key={row.key} className="flex items-end gap-2">
              <label className="block flex-1">
                <span className="mb-1 block text-micro font-semibold text-muted">Название</span>
                <input
                  type="text"
                  value={row.name}
                  onChange={(e) => updateSplitRow(row.key, { name: e.target.value })}
                  className={inputClass}
                />
              </label>
              <label className="block w-24">
                <span className="mb-1 block text-micro font-semibold text-muted">
                  Кол-во, {item.unit}
                </span>
                <input
                  type="number"
                  min={1}
                  value={row.qty}
                  onChange={(e) => updateSplitRow(row.key, { qty: e.target.value })}
                  className={inputClass}
                />
              </label>
              <button
                type="button"
                onClick={() => removeSplitRow(row.key)}
                disabled={splitRows.length <= 2}
                className="h-[38px] rounded-control border border-rule px-2.5 text-fine text-muted transition-colors duration-[var(--duration-instant)] hover:bg-page disabled:opacity-40"
              >
                Убрать
              </button>
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={addSplitRow} className="self-start">
            + Добавить часть
          </Button>
          <div className="flex gap-2">
            <Button variant="primary" size="sm" loading={splitPending} onClick={submitSplit}>
              Разделить
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setSplitting(false)}>
              Отмена
            </Button>
          </div>
          {splitError && <p className="text-fine text-signal">{splitError}</p>}
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 gap-3">
              {selectable && (
                <input
                  type="checkbox"
                  checked={Boolean(selected)}
                  onChange={onToggleSelect}
                  className="mt-1 h-4 w-4 shrink-0"
                  aria-label={`Выбрать «${item.name}» для объединения`}
                />
              )}
              <div className="min-w-0">
                <p className="font-semibold text-ink">{item.name}</p>
                <p className="mt-0.5 text-fine text-muted">
                  {categoryLabel} · {item.qty} {item.unit}
                  {item.requiredCapabilities.length > 0 &&
                    ` · ${item.requiredCapabilities.join(', ')}`}
                </p>
                {item.sourceText && (
                  <p className="mt-1.5 text-fine text-muted italic">«{item.sourceText}»</p>
                )}
              </div>
            </div>
            {item.needsClarification && (
              <Stamp tone="signal" className="shrink-0">
                требует уточнения
              </Stamp>
            )}
          </div>
          {item.needsClarification && item.clarificationReason && (
            <p className="mt-2 text-fine text-status-danger-fg">{item.clarificationReason}</p>
          )}
          {editable && (
            <div className="mt-3 flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                {item.needsClarification ? 'Уточнить позицию' : 'Изменить позицию'}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setSplitting(true)}>
                Разделить
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
