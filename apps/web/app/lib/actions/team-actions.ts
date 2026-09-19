'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { actionFailure } from '../action-result';
import { requireCurrentUser } from '../current-user';
import type { ActionResult } from './request-actions';
import { type InviteTeamMemberInput, normalizeInviteTeamMemberInput } from './team-invitation';

/**
 * Команда и доступы (agents.md §10). Роль владельца проверяется и здесь, и
 * в базе — RPC `set_team_member_access` отказывает не-владельцу сама, а
 * политики `permissions_*_owner` не пустят его запись. Проверка в
 * приложении нужна, чтобы отказ был понятным сообщением, а не сырой
 * ошибкой Postgres; границей остаётся база.
 *
 * Приглашение использует service-role только внутри owner-only server
 * action. Ключ не попадает в клиентский bundle и не используется для
 * чтения бизнес-данных.
 */

async function requireOwner(): Promise<
  ActionResult & { companyId?: string; companyType?: 'buyer' | 'supplier' }
> {
  const user = await requireCurrentUser();
  if (user.role !== 'owner' || !user.companyType || !user.companyId) {
    return { ok: false, error: 'Менять доступы может только владелец компании' };
  }
  return { ok: true, companyId: user.companyId, companyType: user.companyType };
}

export async function inviteTeamMember(input: InviteTeamMemberInput): Promise<ActionResult> {
  const gate = await requireOwner();
  if (!gate.ok || !gate.companyId) return gate;
  const normalized = normalizeInviteTeamMemberInput(input);
  if (typeof normalized === 'string') return { ok: false, error: normalized };

  let admin: ReturnType<typeof createSupabaseAdminClient>;
  try {
    admin = createSupabaseAdminClient();
  } catch (error) {
    return actionFailure('team.inviteTeamMember', error, 'Приглашения отключены');
  }

  const { data, error: inviteError } = await admin.auth.admin.inviteUserByEmail(normalized.email, {
    data: {
      full_name: normalized.fullName,
      company_id: gate.companyId,
      role: 'manager',
      company_type: gate.companyType,
    },
  });
  if (inviteError || !data.user) {
    return actionFailure('team.inviteTeamMember', inviteError, 'Не удалось создать приглашение');
  }

  const { error: profileError } = await admin.from('users').insert({
    id: data.user.id,
    company_id: gate.companyId,
    email: normalized.email,
    full_name: normalized.fullName,
    role: 'manager',
    approval_limit_kzt: normalized.approvalLimitKzt,
    is_active: true,
  });
  if (profileError) {
    // Не оставлять auth-пользователя без профиля при сбое записи профиля.
    await admin.auth.admin.deleteUser(data.user.id);
    return actionFailure('team.inviteTeamMember', profileError);
  }

  revalidatePath('/buyer/team');
  revalidatePath('/supplier/team');
  return { ok: true };
}

export async function setTeamMemberAccess(
  userId: string,
  approvalLimitKzt: number | null,
  isActive: boolean,
): Promise<ActionResult> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;
  if (!z.string().uuid().safeParse(userId).success) {
    return { ok: false, error: 'Сотрудник указан некорректно' };
  }
  if (
    approvalLimitKzt !== null &&
    (!Number.isSafeInteger(approvalLimitKzt) || approvalLimitKzt < 0)
  ) {
    return { ok: false, error: 'Лимит должен быть целым неотрицательным числом' };
  }
  if (typeof isActive !== 'boolean') {
    return { ok: false, error: 'Статус доступа указан некорректно' };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('set_team_member_access', {
    p_user_id: userId,
    p_approval_limit_kzt: approvalLimitKzt,
    p_is_active: isActive,
  });
  if (error) return actionFailure('team.setTeamMemberAccess', error);

  revalidatePath('/buyer/team');
  revalidatePath('/supplier/team');
  return { ok: true };
}

export async function setTeamMemberPermission(
  userId: string,
  key: string,
  value: boolean,
): Promise<ActionResult> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;
  if (!z.string().uuid().safeParse(userId).success) {
    return { ok: false, error: 'Сотрудник указан некорректно' };
  }
  if (!z.string().trim().min(1).max(120).safeParse(key).success) {
    return { ok: false, error: 'Право указано некорректно' };
  }
  if (typeof value !== 'boolean') {
    return { ok: false, error: 'Значение права указано некорректно' };
  }
  const normalizedKey = key.trim();

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from('permissions')
    .select('id')
    .eq('user_id', userId)
    .eq('key', normalizedKey)
    .maybeSingle();

  const { error } = existing
    ? await supabase.from('permissions').update({ value }).eq('id', existing.id)
    : await supabase.from('permissions').insert({ user_id: userId, key: normalizedKey, value });
  if (error) return actionFailure('team.setTeamMemberPermission', error);

  revalidatePath('/buyer/team');
  revalidatePath('/supplier/team');
  return { ok: true };
}
