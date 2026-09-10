'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireCurrentUser } from '../current-user';
import type { ActionResult } from './request-actions';

/**
 * Команда и доступы (agents.md §10). Роль владельца проверяется и здесь, и
 * в базе — RPC `set_team_member_access` отказывает не-владельцу сама, а
 * политики `permissions_*_owner` не пустят его запись. Проверка в
 * приложении нужна, чтобы отказ был понятным сообщением, а не сырой
 * ошибкой Postgres; границей остаётся база.
 *
 * Приглашения сотрудника здесь НЕТ, и это осознанно: завести нового
 * пользователя — это создать запись в `auth.users`, что требует
 * service-role-ключа, а `apps/web` работает только под сессией
 * пользователя (единственное исключение — ссылка для жюри на /metrics,
 * обосновано там же). Кнопка «Пригласить», которая ничего не создаёт,
 * была бы ровно тем, что этот заход и убирает с экранов покупателя.
 */

async function requireOwner(): Promise<ActionResult> {
  const user = await requireCurrentUser();
  if (user.role !== 'owner') {
    return { ok: false, error: 'Менять доступы может только владелец компании' };
  }
  return { ok: true };
}

export async function setTeamMemberAccess(
  userId: string,
  approvalLimitKzt: number | null,
  isActive: boolean,
): Promise<ActionResult> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('set_team_member_access', {
    p_user_id: userId,
    p_approval_limit_kzt: approvalLimitKzt,
    p_is_active: isActive,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/buyer/team');
  return { ok: true };
}

export async function setTeamMemberPermission(
  userId: string,
  key: string,
  value: boolean,
): Promise<ActionResult> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from('permissions')
    .select('id')
    .eq('user_id', userId)
    .eq('key', key)
    .maybeSingle();

  const { error } = existing
    ? await supabase.from('permissions').update({ value }).eq('id', existing.id)
    : await supabase.from('permissions').insert({ user_id: userId, key, value });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/buyer/team');
  return { ok: true };
}
