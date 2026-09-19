'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { actionFailure } from '../action-result';
import { orderActorFor, requireCurrentUser } from '../current-user';
import type { ActionResult } from './request-actions';

const uuid = z.string().uuid();
const noteSchema = z.string().trim().min(5).max(2000);

/**
 * Staff asks a supplier to correct a submitted quote. The database RPC keeps
 * the RFQ lock and the revision flag in one transaction; this action only
 * handles authorization, input shape, and cache invalidation.
 */
export async function requestQuoteRevision(rfqId: string, note: string): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const actor = orderActorFor(user);
  if (actor !== 'concierge' && actor !== 'admin') {
    return { ok: false, error: 'Запросить исправление КП может только QAJET' };
  }
  if (!uuid.safeParse(rfqId).success) return { ok: false, error: 'RFQ указан некорректно' };
  const parsedNote = noteSchema.safeParse(note);
  if (!parsedNote.success) return { ok: false, error: 'Причина должна быть от 5 до 2000 символов' };

  const supabase = await createSupabaseServerClient();
  const { data: rfq, error: rfqError } = await supabase
    .from('rfqs')
    .select('id, request_id')
    .eq('id', rfqId)
    .maybeSingle();
  if (rfqError || !rfq)
    return actionFailure('quote.requestQuoteRevision', rfqError, 'RFQ не найден');

  const { error } = await supabase.rpc('request_supplier_quote_revision', {
    p_rfq_id: rfq.id,
    p_note: parsedNote.data,
  });
  if (error) return actionFailure('quote.requestQuoteRevision', error);

  const { data: order } = await supabase
    .from('orders')
    .select('id')
    .eq('request_id', rfq.request_id)
    .maybeSingle();
  if (order) {
    revalidatePath(`/concierge/orders/${order.id}`);
    revalidatePath(`/concierge/orders/${order.id}/quotes`);
  }
  revalidatePath('/concierge');
  revalidatePath('/supplier');
  revalidatePath(`/supplier/rfq/${rfq.id}`);
  return { ok: true };
}
