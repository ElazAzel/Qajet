'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { cn } from '@qajet/ui/lib/cn';
import { useEffect, useState } from 'react';
import { editMessage, markThreadRead } from './actions/message-actions';
import type { ThreadMessage } from './buyer-messages';

export function MarkThreadRead({ threadId }: { threadId: string }) {
  useEffect(() => {
    void markThreadRead(threadId);
  }, [threadId]);
  return null;
}

export function MessageBubble({
  message,
  returnPath,
}: {
  message: ThreadMessage;
  returnPath: string;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(message.body);
  const { run, pending, error } = useAsyncAction(editMessage, () => setEditing(false));

  if (editing) {
    return (
      <div className="flex justify-end">
        <div className="w-full max-w-[70%]">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
            maxLength={10_000}
            className="w-full rounded-control border border-rule bg-page px-3 py-2 text-fine text-ink"
            aria-label="Редактирование сообщения"
          />
          <div className="mt-1 flex justify-end gap-2">
            <button
              type="button"
              className="text-micro text-muted"
              onClick={() => setEditing(false)}
            >
              Отмена
            </button>
            <button
              type="button"
              disabled={pending || !body.trim()}
              className="text-micro font-semibold text-purple disabled:opacity-40"
              onClick={() => run(message.id, body, returnPath)}
            >
              {pending ? 'Сохраняю…' : 'Сохранить'}
            </button>
          </div>
          {error && <p className="mt-1 text-micro text-danger">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex', message.mine ? 'justify-end' : 'justify-start')}>
      <div className="max-w-[70%]">
        <p
          className={cn(
            'rounded-control px-4 py-2.5 text-fine leading-relaxed',
            message.mine ? 'bg-purple text-white' : 'bg-page text-ink',
          )}
        >
          {message.body}
        </p>
        {message.mine && (
          <button
            type="button"
            className="mt-1 text-micro text-muted hover:text-ink"
            onClick={() => setEditing(true)}
          >
            Изменить
          </button>
        )}
      </div>
    </div>
  );
}
