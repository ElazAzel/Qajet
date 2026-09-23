'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { Button, Card } from '@qajet/ui/primitives';
import { useState } from 'react';
import { addInternalNote } from '../../../lib/actions/order-actions';
import { formatDateTime } from '../../../lib/dates';
import type { OrderNote } from '../../../lib/order-notes';

/**
 * Внутренние заметки — agents.md §5, §10 «Консьерж → внутренние заметки».
 * «Видны только сотрудникам QAJET» физически обеспечивает RLS
 * (`threads.kind='internal'`, миграция 0000) — этот компонент рендерится
 * только в staff-контексте (см. вызовы в page.tsx под `canPropose`), но
 * если бы покупатель сюда как-то попал, запрос всё равно вернул бы пусто.
 */
export function OrderNotes({ orderId, notes }: { orderId: string; notes: OrderNote[] }) {
  const [body, setBody] = useState('');
  const { run, pending, error } = useAsyncAction(async () => {
    const result = await addInternalNote(orderId, body);
    if (result.ok) setBody('');
    return result;
  });

  return (
    <Card padding="sm">
      <p className="text-sm font-bold text-ink">Внутренние заметки</p>
      <p className="mt-0.5 text-micro text-muted">Видны только сотрудникам QAJET.</p>

      {notes.length === 0 ? (
        <p className="mt-3 text-fine text-muted">Заметок пока нет.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2.5">
          {notes.map((note) => (
            <li key={note.id} className="text-fine">
              <p className="text-ink">{note.body}</p>
              <p className="mt-0.5 text-micro text-muted">
                {note.authorName} · {formatDateTime(note.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-end gap-2 border-rule border-t pt-4">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Заметка для коллег…"
          rows={2}
          aria-label="Текст внутренней заметки"
          className="w-full rounded-control bg-page px-3 py-2 text-fine text-ink"
        />
        <Button
          variant="secondary"
          size="sm"
          loading={pending}
          onClick={run}
          disabled={!body.trim()}
        >
          Добавить
        </Button>
      </div>
      {error && <p className="mt-1 text-fine text-danger">{error}</p>}
    </Card>
  );
}
