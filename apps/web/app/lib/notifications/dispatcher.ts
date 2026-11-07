import 'server-only';

import { randomUUID } from 'node:crypto';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createEmailAdapter } from './email-adapter';

interface OutboxRow {
  id: string;
  idempotency_key: string;
  recipient: string;
  subject: string;
  body: string;
}

export interface DispatchResult {
  claimed: number;
  sent: number;
  failed: number;
  /** Failed rows whose failure/retry transition could not be confirmed. */
  retryUnconfirmed: number;
  errors: string[];
}

/** One leased batch per invocation; retries reuse the provider idempotency key. */
export async function dispatchOutbox(limit = 20): Promise<DispatchResult> {
  // Адаптер создаётся ДО claim: claim_outbox_batch увеличивает attempts, и при
  // ненастроенной почте каждый запуск сжигал бы попытки у всех строк очереди.
  // Так строки остаются pending, а задача падает с 503 и это видно в workflow.
  const adapter = createEmailAdapter();
  const supabase = createSupabaseAdminClient();
  const leaseId = randomUUID();
  const { data, error } = await supabase.rpc('claim_outbox_batch', {
    p_limit: limit,
    p_lease_id: leaseId,
  });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as OutboxRow[];
  const result: DispatchResult = {
    claimed: rows.length,
    sent: 0,
    failed: 0,
    retryUnconfirmed: 0,
    errors: [],
  };

  for (const row of rows) {
    try {
      const delivered = await adapter.send({
        idempotencyKey: row.idempotency_key,
        recipient: row.recipient,
        subject: row.subject,
        body: row.body,
      });
      const { data: completed, error: completeError } = await supabase.rpc('complete_outbox', {
        p_id: row.id,
        p_lease_id: leaseId,
        p_provider_message_id: delivered.providerMessageId,
      });
      if (completeError) throw new Error(completeError.message);
      if (completed !== true) throw new Error('Lease outbox истёк до фиксации результата');
      result.sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Неизвестная ошибка отправки';
      result.failed += 1;
      result.errors.push(`${row.id}: ${message}`);
      try {
        const { data: failed, error: failError } = await supabase.rpc('fail_outbox', {
          p_id: row.id,
          p_lease_id: leaseId,
          p_error: message,
        });
        if (failError || failed !== true) throw new Error('outbox.retry_unconfirmed');
      } catch {
        // Completion may already have committed, or the lease may recover
        // later. Do not claim a retry was scheduled or abandon later rows.
        result.retryUnconfirmed += 1;
        result.errors.push(`${row.id}: outbox.retry_unconfirmed`);
      }
    }
  }

  return result;
}
