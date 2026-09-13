'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { Button } from '@qajet/ui/primitives';
import { useRouter } from 'next/navigation';
import { resolvePlanChange } from '../../../lib/actions/change-request-actions';

export function PlanChangeActions({ changeRequestId }: { changeRequestId: string }) {
  const router = useRouter();
  const { run, pending, error } = useAsyncAction(resolvePlanChange, () => router.refresh());
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Button size="sm" loading={pending} onClick={() => run(changeRequestId, 'accepted')}>
        Создать новую версию
      </Button>
      <Button
        size="sm"
        variant="secondary"
        loading={pending}
        onClick={() => run(changeRequestId, 'declined')}
      >
        Отклонить
      </Button>
      {error && <p className="w-full text-fine text-signal">{error}</p>}
    </div>
  );
}
