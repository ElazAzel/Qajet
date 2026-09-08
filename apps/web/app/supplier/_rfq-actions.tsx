'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { Button } from '@qajet/ui/primitives';
import Link from 'next/link';
import { declineRfq } from '../lib/actions/supplier-actions';

/** Двухступенчатый ответ, шаг 1 — agents.md §10: «берусь / не берусь» до полного КП. */
export function RfqActions({ rfqId }: { rfqId: string }) {
  const { run, pending, error } = useAsyncAction(declineRfq);

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2 sm:shrink-0">
        <Button variant="secondary" size="sm" loading={pending} onClick={() => run(rfqId)}>
          Не берусь
        </Button>
        <Link
          href={`/supplier/rfq/${rfqId}`}
          className="inline-flex h-9 items-center justify-center rounded-control bg-ink px-3.5 text-fine font-semibold text-surface transition-colors duration-[var(--duration-instant)] hover:opacity-90"
        >
          Берусь, цена и срок
        </Link>
      </div>
      {error && <p className="max-w-[200px] text-right text-micro text-signal">{error}</p>}
    </div>
  );
}
