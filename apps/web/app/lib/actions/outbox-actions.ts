'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { actionFailure } from '../action-result';
import { requireActor } from '../current-user';
import type { ActionResult } from './request-actions';

const uuid = z.string().uuid();

/** Возвращает failed-сообщение в очередь. Только admin и только по id:
 * worker сам сохраняет lease/idempotency и не создаёт новую запись. */
export async function retryOutbox(id: string): Promise<ActionResult> {
  await requireActor('admin');
  if (!uuid.safeParse(id).success) return { ok: false, error: 'Уведомление указано некорректно' };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('outbox')
    .update({
      status: 'pending',
      available_at: new Date().toISOString(),
      lease_id: null,
      leased_until: null,
      last_error: null,
      delivery_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'failed')
    .select('id')
    .maybeSingle();
  if (error) return actionFailure('outbox.retryOutbox', error);
  if (!data) return { ok: false, error: 'Повтор доступен только для failed-сообщения' };

  revalidatePath('/admin/outbox');
  return { ok: true };
}
