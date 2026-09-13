'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { Button } from '@qajet/ui/primitives';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { requestQuoteRevision } from '../../../../lib/actions/quote-actions';

export function RequestQuoteRevision({ rfqId }: { rfqId: string }) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const { run, pending, error } = useAsyncAction(requestQuoteRevision, () => {
    setNote('');
    router.refresh();
  });

  return (
    <div className="mt-4 border-rule border-t pt-4">
      <label className="block text-fine text-muted">
        Что нужно уточнить или исправить
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={2000}
          className="mt-1 w-full rounded-control border border-rule bg-page px-3 py-2 text-sm text-ink"
          placeholder="Например: добавьте стоимость нанесения и подтвердите срок"
        />
      </label>
      <Button
        className="mt-2"
        variant="secondary"
        size="sm"
        loading={pending}
        disabled={note.trim().length < 5}
        onClick={() => run(rfqId, note)}
      >
        {pending ? 'Отправляю…' : 'Запросить исправление'}
      </Button>
      {error && <p className="mt-2 text-fine text-danger">{error}</p>}
    </div>
  );
}
