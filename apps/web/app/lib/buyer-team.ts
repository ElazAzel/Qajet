import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Команда и доступы покупателя — agents.md §10: «приглашение, лимиты
 * согласования, отзыв доступа». Экрана не существовало вовсе, пункт
 * навигации был убран как ведущий на 404 (см. комментарий в
 * `apps/web/app/buyer/layout.tsx`).
 *
 * Лимит согласования живёт колонкой `users.approval_limit_kzt` (§13 требует
 * «2 сотрудника с разными лимитами» — они и заведены сидом), а поимённые
 * права — строками `permissions`. Менять и то, и другое может только
 * владелец компании: лимит — через RPC `set_team_member_access` (RLS не
 * умеет ограничивать колонки, и политика на users дала бы владельцу право
 * переписать коллеге роль или email), права — напрямую под политиками
 * `permissions_insert_owner`/`permissions_update_owner`.
 */

/** Ключи прав, которые компания выдаёт сотрудникам. Порядок — порядок в UI. */
export const TEAM_PERMISSION_KEYS = [
  { key: 'can_create_request', label: 'Создавать заявки' },
  { key: 'can_approve_plan', label: 'Утверждать планы' },
  { key: 'can_manage_team', label: 'Управлять командой' },
] as const;

export type TeamPermissionKey = (typeof TEAM_PERMISSION_KEYS)[number]['key'];

export interface TeamMember {
  id: string;
  fullName: string;
  email: string;
  role: string;
  approvalLimitKzt: number | null;
  isActive: boolean;
  permissions: Record<string, boolean>;
}

export const ROLE_LABEL: Record<string, string> = {
  owner: 'Владелец компании',
  manager: 'Менеджер',
};

export async function loadTeam(supabase: SupabaseClient): Promise<TeamMember[]> {
  // RLS (`users_select_own_company`) уже ограничивает выборку компанией
  // текущего пользователя — отдельного .eq по company_id здесь нет.
  const { data: userRows } = await supabase
    .from('users')
    .select('id, full_name, email, role, approval_limit_kzt, is_active')
    .order('role', { ascending: true });

  const users = userRows ?? [];
  if (users.length === 0) return [];

  const { data: permissionRows } = await supabase
    .from('permissions')
    .select('user_id, key, value')
    .in(
      'user_id',
      users.map((u) => u.id),
    );

  const byUser = new Map<string, Record<string, boolean>>();
  for (const row of permissionRows ?? []) {
    const current = byUser.get(row.user_id) ?? {};
    current[row.key] = row.value === true;
    byUser.set(row.user_id, current);
  }

  return users.map((user) => ({
    id: user.id,
    fullName: user.full_name,
    email: user.email,
    role: user.role,
    approvalLimitKzt: user.approval_limit_kzt,
    isActive: user.is_active,
    permissions: byUser.get(user.id) ?? {},
  }));
}
