'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { useRouter } from 'next/navigation';
import { assignOrderConcierge } from '../../../lib/actions/assignment-actions';

export interface ConciergeOption {
  id: string;
  fullName: string;
  role: string;
}

export function ConciergeAssignment({
  orderId,
  currentUserId,
  options,
}: {
  orderId: string;
  currentUserId: string | null;
  options: ConciergeOption[];
}) {
  const router = useRouter();
  const { run, pending, error } = useAsyncAction(assignOrderConcierge, () => router.refresh());

  return (
    <div className="mt-4 rounded-card-sm border border-rule bg-page p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-fine text-muted">
          Ответственный QAJET
          <select
            value={currentUserId ?? ''}
            onChange={(event) => run(orderId, event.target.value || null)}
            disabled={pending}
            className="rounded-control border border-rule bg-surface px-3 py-2 text-sm text-ink"
          >
            <option value="">Без назначения</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.fullName} · {option.role}
              </option>
            ))}
          </select>
        </label>
        {pending && <span className="text-fine text-muted">Сохраняю…</span>}
      </div>
      {error && <p className="mt-2 text-fine text-signal">{error}</p>}
    </div>
  );
}
