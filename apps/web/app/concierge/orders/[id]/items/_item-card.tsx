'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { Stamp } from '@qajet/ui/motion';
import { Button, Card } from '@qajet/ui/primitives';
import { useState } from 'react';
import { correctItemClassification } from '../../../../lib/actions/item-actions';
import { CATEGORY_LABEL, type CatalogCategory } from '../../../../lib/catalog';

const CATEGORIES: CatalogCategory[] = ['merch', 'corporate-gifts', 'printing'];

const inputClass =
  'w-full rounded-control border border-transparent bg-page px-3 py-2 text-fine text-ink focus-visible:border-purple';

export interface ItemCardData {
  id: string;
  name: string;
  category: string;
  qty: number;
  unit: string;
  requiredCapabilities: string[];
  sourceText?: string | undefined;
  needsClarification: boolean;
  clarificationReason: string | null;
}

/**
 * Карточка позиции заявки — просмотр + правка категории/названия
 * (Classification Engine, agents.md §8A). Изменение категории пишет
 * learning_events/extraction_aliases на сервере (item-actions.ts) — сама
 * карточка только собирает форму, обучающий сигнал формируется там.
 */
export function ItemCard({ item, editable }: { item: ItemCardData; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const [category, setCategory] = useState(item.category);
  const [name, setName] = useState(item.name);
  const { run, pending, error } = useAsyncAction(correctItemClassification, () =>
    setEditing(false),
  );

  const categoryLabel = CATEGORY_LABEL[item.category as CatalogCategory] ?? item.category;

  return (
    <Card padding="sm">
      {editing ? (
        <div className="flex flex-col gap-2.5">
          <label className="block">
            <span className="mb-1 block text-micro font-semibold text-muted">Название</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-micro font-semibold text-muted">Категория</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={inputClass}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              loading={pending}
              onClick={() => run(item.id, { category, name })}
            >
              Сохранить
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
              Отмена
            </Button>
          </div>
          {error && <p className="text-fine text-signal">{error}</p>}
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-4">
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
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => setEditing(true)}>
              Изменить категорию
            </Button>
          )}
        </>
      )}
    </Card>
  );
}
