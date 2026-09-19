'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { actionFailure } from '../action-result';
import { orderActorFor, requireCurrentUser } from '../current-user';
import type { ActionResult } from './request-actions';

const companyInputSchema = z
  .object({
    type: z.enum(['buyer', 'supplier']),
    name: z.string().trim().min(2).max(200),
    bin: z
      .string()
      .trim()
      .regex(/^\d{12}$/, 'БИН должен содержать 12 цифр'),
    city: z.string().trim().min(2).max(120),
    ownerEmail: z.string().trim().email().max(320),
    ownerFullName: z.string().trim().min(2).max(120),
  })
  .strict();

export type CompanyInput = z.infer<typeof companyInputSchema>;

async function requireAdmin() {
  const user = await requireCurrentUser();
  return orderActorFor(user) === 'admin' ? user : null;
}

/** Создаёт пилотную B2B-компанию и её первого owner-а одним управляемым
 * admin-потоком. Публичная форма регистрации этого не делает. */
export async function createCompanyWithOwner(rawInput: CompanyInput): Promise<ActionResult> {
  const adminUser = await requireAdmin();
  if (!adminUser) return { ok: false, error: 'Только админ QAJET может подключать компании' };
  const parsed = companyInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: 'Проверьте реквизиты компании и owner-а' };

  let service: ReturnType<typeof createSupabaseAdminClient>;
  try {
    service = createSupabaseAdminClient();
  } catch (error) {
    return actionFailure('company.createCompanyWithOwner', error, 'Admin API недоступен');
  }

  const input = parsed.data;
  const { data: company, error: companyError } = await service
    .from('companies')
    .insert({
      type: input.type,
      name: input.name,
      bin: input.bin,
      city: input.city,
      is_active: true,
    })
    .select('id')
    .single();
  if (companyError || !company) {
    return actionFailure(
      'company.createCompanyWithOwner',
      companyError,
      'Не удалось создать компанию',
    );
  }

  const { data: invited, error: inviteError } = await service.auth.admin.inviteUserByEmail(
    input.ownerEmail,
    {
      data: {
        full_name: input.ownerFullName,
        company_id: company.id,
        company_type: input.type,
        role: 'owner',
      },
    },
  );
  if (inviteError || !invited.user) {
    await service.from('companies').delete().eq('id', company.id);
    return actionFailure(
      'company.createCompanyWithOwner',
      inviteError,
      'Не удалось отправить приглашение owner-у',
    );
  }

  const { error: profileError } = await service.from('users').insert({
    id: invited.user.id,
    company_id: company.id,
    email: input.ownerEmail,
    full_name: input.ownerFullName,
    role: 'owner',
    is_active: true,
  });
  if (profileError) {
    await service.auth.admin.deleteUser(invited.user.id);
    await service.from('companies').delete().eq('id', company.id);
    return actionFailure('company.createCompanyWithOwner', profileError);
  }

  if (input.type === 'supplier') {
    const { error: profileError } = await service.from('supplier_profiles').insert({
      company_id: company.id,
      categories: [],
      capabilities: [],
      portfolio_urls: [],
    });
    if (profileError) {
      await service.auth.admin.deleteUser(invited.user.id);
      await service.from('users').delete().eq('id', invited.user.id);
      await service.from('companies').delete().eq('id', company.id);
      return actionFailure('company.createCompanyWithOwner', profileError);
    }
  }

  revalidatePath('/admin');
  revalidatePath('/admin/companies');
  return { ok: true };
}

export async function verifySupplierCompany(
  companyId: string,
  status: 'approved' | 'rejected',
  note: string,
): Promise<ActionResult> {
  const adminUser = await requireAdmin();
  if (!adminUser) return { ok: false, error: 'Только админ QAJET может менять верификацию' };
  if (!z.string().uuid().safeParse(companyId).success) {
    return { ok: false, error: 'Компания указана некорректно' };
  }
  const cleanNote = note.trim();
  if (cleanNote.length > 1000) return { ok: false, error: 'Комментарий слишком длинный' };

  let service: ReturnType<typeof createSupabaseAdminClient>;
  try {
    service = createSupabaseAdminClient();
  } catch (error) {
    return actionFailure('company.verifySupplierCompany', error, 'Admin API недоступен');
  }
  const { error } = await service
    .from('companies')
    .update({
      verified_at: status === 'approved' ? new Date().toISOString() : null,
      verification_note: cleanNote || (status === 'approved' ? 'Проверено админом QAJET' : null),
    })
    .eq('id', companyId)
    .eq('type', 'supplier');
  if (error) return actionFailure('company.verifySupplierCompany', error);

  revalidatePath('/admin');
  revalidatePath('/admin/companies');
  return { ok: true };
}

/** Повторное приглашение не создаёт вторую public.users-строку: Auth
 * генерирует новую одноразовую ссылку, а отправку кладём в outbox. */
export async function resendOwnerInvite(userId: string): Promise<ActionResult> {
  const adminUser = await requireAdmin();
  if (!adminUser) return { ok: false, error: 'Только админ QAJET может повторить приглашение' };
  if (!z.string().uuid().safeParse(userId).success)
    return { ok: false, error: 'Owner указан некорректно' };
  let service: ReturnType<typeof createSupabaseAdminClient>;
  try {
    service = createSupabaseAdminClient();
  } catch (error) {
    return actionFailure('company.resendOwnerInvite', error, 'Admin API недоступен');
  }
  const { data: owner, error: ownerError } = await service
    .from('users')
    .select('id, email, companies(name)')
    .eq('id', userId)
    .eq('role', 'owner')
    .maybeSingle();
  if (ownerError || !owner)
    return actionFailure('company.resendOwnerInvite', ownerError, 'Owner не найден');
  const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ?? 'http://localhost:3000';
  const { data: link, error: linkError } = await service.auth.admin.generateLink({
    type: 'invite',
    email: owner.email,
    options: {
      redirectTo: `${origin}/auth/confirm?next=${encodeURIComponent('/auth/set-password')}`,
    },
  });
  if (linkError || !link.properties?.action_link) {
    return actionFailure(
      'company.resendOwnerInvite',
      linkError,
      'Не удалось создать ссылку приглашения',
    );
  }
  const company = Array.isArray(owner.companies) ? owner.companies[0] : owner.companies;
  const { error: outboxError } = await service.from('outbox').insert({
    kind: 'company_owner_invite',
    recipient: owner.email,
    subject: `QAJET: приглашение в ${company?.name ?? 'рабочий кабинет'}`,
    body: `Откройте одноразовую ссылку и установите пароль: ${link.properties.action_link}`,
    payload: { userId: owner.id, actionLink: link.properties.action_link },
    status: 'pending',
  });
  if (outboxError) return actionFailure('company.resendOwnerInvite', outboxError);
  return { ok: true };
}
