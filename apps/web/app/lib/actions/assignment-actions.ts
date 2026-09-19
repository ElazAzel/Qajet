'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { type ActionResult, actionFailure } from '../action-result';
import { requireCurrentUser } from '../current-user';

export type AssignmentActionResult = ActionResult;

const uuid = z.string().uuid();

/** Owner-only reassignment for supplier RFQs. History stays on its authors. */
export async function assignSupplierRfq(
  rfqId: string,
  supplierUserId: string | null,
): Promise<AssignmentActionResult> {
  const user = await requireCurrentUser();
  if (user.role !== 'owner' || user.companyType !== 'supplier') {
    return { ok: false, error: 'Назначать RFQ может только владелец компании-поставщика' };
  }
  if (
    !uuid.safeParse(rfqId).success ||
    (supplierUserId !== null && !uuid.safeParse(supplierUserId).success)
  ) {
    return { ok: false, error: 'RFQ или сотрудник указаны некорректно' };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('assign_supplier_rfq', {
    p_rfq_id: rfqId,
    p_supplier_user_id: supplierUserId,
  });
  if (error) return actionFailure('assignment.assignSupplierRfq', error);

  revalidatePath('/supplier');
  revalidatePath('/supplier/messages');
  return { ok: true };
}

/** Staff-only order transfer; messages and audit authors remain unchanged. */
export async function assignOrderConcierge(
  orderId: string,
  conciergeUserId: string | null,
): Promise<AssignmentActionResult> {
  const user = await requireCurrentUser();
  if (user.role !== 'concierge' && user.role !== 'admin') {
    return { ok: false, error: 'Передавать заказ может только сотрудник QAJET' };
  }
  if (
    !uuid.safeParse(orderId).success ||
    (conciergeUserId !== null && !uuid.safeParse(conciergeUserId).success)
  ) {
    return { ok: false, error: 'Заказ или сотрудник указаны некорректно' };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('assign_order_concierge', {
    p_order_id: orderId,
    p_concierge_user_id: conciergeUserId,
  });
  if (error) return actionFailure('assignment.assignOrderConcierge', error);

  revalidatePath('/concierge');
  revalidatePath(`/concierge/orders/${orderId}`);
  revalidatePath(`/concierge/orders/${orderId}/messages`);
  return { ok: true };
}
