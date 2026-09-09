'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { Stagger } from '@qajet/ui/motion';
import { Button, Card } from '@qajet/ui/primitives';
import { useState } from 'react';
import { mergeRequestItems } from '../../../../lib/actions/item-actions';
import { ItemCard, type ItemCardData } from './_item-card';

const inputClass =
  'w-full rounded-control border border-transparent bg-page px-3 py-2 text-fine text-ink focus-visible:border-purple';

/**
 * Список позиций заявки + merge (Dependency Engine, agents.md §8A, шаг 8
 * волны 1). Split живёт в самой карточке (_item-card.tsx) — действует на
 * одну позицию сразу; merge объединяет несколько — выбор чекбоксами
 * пересекает карточки, поэтому состояние здесь, на уровне списка, а не в
 * каждой карточке по отдельности.
 */
export function ItemsList({ items, editable }: { items: ItemCardData[]; editable: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergeName, setMergeName] = useState('');
  const {
    run: runMerge,
    pending: mergePending,
    error: mergeError,
  } = useAsyncAction(mergeRequestItems, () => setSelected(new Set()));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedIds = Array.from(selected);

  return (
    <div className="flex flex-col gap-3">
      <Stagger startIndex={2} className="flex flex-col gap-3">
        {items.map((item) => (
          <ItemCard
            key={item.id}
            editable={editable}
            item={item}
            selectable={editable && items.length > 1}
            selected={selected.has(item.id)}
            onToggleSelect={() => toggle(item.id)}
          />
        ))}
        {items.length === 0 && <p className="text-fine text-muted">В заявке нет позиций.</p>}
      </Stagger>

      {selectedIds.length >= 2 && (
        <Card padding="sm" className="border-purple/40 bg-purple-10">
          <p className="text-fine font-semibold text-ink">
            Объединить выбранное ({selectedIds.length})
          </p>
          <label className="mt-2 block max-w-sm">
            <span className="mb-1 block text-micro font-semibold text-muted">
              Название объединённой позиции (необязательно)
            </span>
            <input
              type="text"
              value={mergeName}
              onChange={(e) => setMergeName(e.target.value)}
              placeholder="По умолчанию — название первой выбранной"
              className={inputClass}
            />
          </label>
          <div className="mt-3 flex gap-2">
            <Button
              variant="primary"
              size="sm"
              loading={mergePending}
              onClick={() =>
                runMerge(selectedIds, mergeName.trim() ? { name: mergeName.trim() } : undefined)
              }
            >
              Объединить выбранное ({selectedIds.length})
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setSelected(new Set())}>
              Снять выбор
            </Button>
          </div>
          {mergeError && <p className="mt-2 text-fine text-signal">{mergeError}</p>}
        </Card>
      )}
    </div>
  );
}
