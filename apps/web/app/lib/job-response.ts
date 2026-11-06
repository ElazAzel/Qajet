import { NextResponse } from 'next/server';
import type { LearningDispatchResult } from './learning/dispatcher';
import type { DispatchResult } from './notifications/dispatcher';
import { logActionFailure } from './server-log';

/** HTTP 200 means the batch returned, not that every item succeeded. */
export function completedJobResponse(
  operation: 'job.outbox' | 'job.learning',
  result: DispatchResult | LearningDispatchResult,
) {
  const retryUnconfirmed = 'retryUnconfirmed' in result ? result.retryUnconfirmed : 0;
  const ok = result.failed === 0 && retryUnconfirmed === 0;
  const supportId = ok
    ? undefined
    : crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  if (supportId) {
    logActionFailure({
      supportId,
      operation,
      code: retryUnconfirmed > 0 ? 'retry_unconfirmed' : 'batch_failed',
      errorName: 'JobBatchFailure',
    });
  }
  // Allowlist the response. Outbox errors may contain provider payloads; keep
  // the array shape/length, but never expose those strings or extra fields.
  return NextResponse.json({
    ok,
    claimed: result.claimed,
    ...('sent' in result ? { sent: result.sent } : { processed: result.processed }),
    failed: result.failed,
    retryUnconfirmed,
    errors: result.errors.map(() => 'job.item_failed'),
    ...(supportId ? { supportId } : {}),
  });
}
