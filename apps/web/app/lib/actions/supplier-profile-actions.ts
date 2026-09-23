'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { actionFailure } from '../action-result';
import { orderActorFor, requireCurrentUser } from '../current-user';
import { normalizeKzPhone } from '../whatsapp';
import type { ActionResult } from './request-actions';

const supplierProfileSchema = z
  .object({
    categories: z.array(z.string().trim().min(1).max(80)).min(1).max(10),
    capabilities: z.array(z.string().trim().min(1).max(80)).min(1).max(30),
    serviceCities: z.array(z.string().trim().min(1).max(120)).max(50),
    minOrderKzt: z.number().int().nonnegative().nullable(),
    leadTimeDaysDefault: z.number().int().positive().max(365).nullable(),
    portfolioUrls: z.array(z.string().trim().url().max(500)).max(10),
    notes: z.string().trim().max(2000),
    /** Пусто — номера нет. Иначе нормализуется к +7XXXXXXXXXX на сервере. */
    whatsappPhone: z.string().trim().max(40),
  })
  .strict();

export type SupplierProfileInput = z.infer<typeof supplierProfileSchema>;

export async function updateSupplierProfile(rawInput: SupplierProfileInput): Promise<ActionResult> {
  const user = await requireCurrentUser();
  if (orderActorFor(user) !== 'supplier' || user.role !== 'owner' || !user.companyId) {
    return { ok: false, error: 'Профиль поставщика может менять только owner' };
  }
  const parsed = supplierProfileSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: 'Проверьте категории, возможности и ссылки' };
  const whatsappPhone = parsed.data.whatsappPhone
    ? normalizeKzPhone(parsed.data.whatsappPhone)
    : null;
  if (parsed.data.whatsappPhone && !whatsappPhone) {
    const message = 'Номер WhatsApp укажите в формате +7 701 123 45 67';
    return { ok: false, code: 'invalid', error: message, fieldErrors: { whatsappPhone: message } };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('supplier_profiles')
    .update({
      categories: parsed.data.categories,
      capabilities: parsed.data.capabilities,
      service_cities: parsed.data.serviceCities,
      min_order_kzt: parsed.data.minOrderKzt,
      lead_time_days_default: parsed.data.leadTimeDaysDefault,
      portfolio_urls: parsed.data.portfolioUrls,
      notes: parsed.data.notes || null,
      whatsapp_phone: whatsappPhone,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', user.companyId);
  if (error) return actionFailure('supplier-profile.updateSupplierProfile', error);

  revalidatePath('/supplier/profile');
  revalidatePath('/supplier');
  revalidatePath('/concierge');
  return { ok: true };
}
