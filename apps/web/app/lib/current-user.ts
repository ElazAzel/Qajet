import { createPdClient } from '@qajet/pd';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Текущий пользователь для оболочек ролей — единая точка, откуда
 * layout.tsx каждой роли берёт данные для хедера (agents.md §12: аватар +
 * имя + компания/роль), вместо хардкода placeholder-строки.
 *
 * Имя и email — персональные данные (agents.md §11.1): читаются через
 * @qajet/pd, а не прямым запросом к users, как роль и компания ниже.
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

interface RoleRow {
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

  const pd = createPdClient(supabase);
  const [contact, roleResult] = await Promise.all([
    pd.getUserContact(authUser.id),
    supabase
      .from('users')
      .select('role, companies(name)')
      .eq('id', authUser.id)
      .maybeSingle<RoleRow>(),
  ]);
  if (!contact || !roleResult.data) redirect('/login');

  const company = Array.isArray(roleResult.data.companies)
    ? roleResult.data.companies[0]
    : roleResult.data.companies;

  return {
    id: contact.id,
    fullName: contact.fullName,
    email: contact.email,
    role: roleResult.data.role,
    companyName: company?.name ?? null,
  };
}

export function shellUserFrom(user: CurrentUser): { name: string; meta: string } {
  return { name: user.fullName, meta: user.companyName ?? ROLE_LABEL[user.role] };
}
