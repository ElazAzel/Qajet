'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { Button } from '@qajet/ui/primitives';
import { useRouter } from 'next/navigation';
import { retryOutbox } from '../../lib/actions/outbox-actions';

export function RetryOutboxButton({ id }: { id: string }) {
  const router = useRouter();
  const { run, pending, error } = useAsyncAction(async () => {
    const result = await retryOutbox(id);
    if (result.ok) router.refresh();
    return result;
  });

  return (
    <div className="mt-2">
      <Button variant="secondary" size="sm" loading={pending} onClick={run}>
        Повторить
      </Button>
      {error && <p className="mt-1 max-w-48 text-micro text-danger">{error}</p>}
    </div>
  );
}
