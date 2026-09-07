import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Текущий пользователь для оболочек ролей — единая точка, откуда
 * layout.tsx каждой роли берёт данные для хедера (agents.md §12: аватар +
 * имя + компания/роль), вместо хардкода placeholder-строки.
 */

export type UserRole = 'owner' | 'manager' | 'concierge' | 'admin';

export interface CurrentUser {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  companyName: string | null;
}

const ROLE_LABEL: Record<UserRole, string> = {
  owner: 'Владелец компании',
  manager: 'Менеджер',
  concierge: 'Консьерж QAJET',
  admin: 'Админ QAJET',
};

interface ProfileRow {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  companies: { name: string } | { name: string }[] | null;
}

/** Редиректит на /login, если сессии нет или профиль не найден — те же
 *  условия, при которых сегодня рендерился бы пустой хедер. */
export async function requireCurrentUser(): Promise<CurrentUser> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) redirect('/login');

  const { data } = await supabase
    .from('users')
    .select('id, full_name, email, role, companies(name)')
    .eq('id', authUser.id)
    .maybeSingle<ProfileRow>();
  if (!data) redirect('/login');

  const company = Array.isArray(data.companies) ? data.companies[0] : data.companies;

  return {
    id: data.id,
    fullName: data.full_name,
    email: data.email,
    role: data.role,
    companyName: company?.name ?? null,
  };
}

export function shellUserFrom(user: CurrentUser): { name: string; meta: string } {
  return { name: user.fullName, meta: user.companyName ?? ROLE_LABEL[user.role] };
}
