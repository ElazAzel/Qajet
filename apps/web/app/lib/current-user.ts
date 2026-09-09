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
export type CompanyType = 'buyer' | 'supplier';

/** Кто физически совершает переход состояния заказа — agents.md §6, packages/engine/order. */
export type OrderActor = 'buyer' | 'concierge' | 'supplier' | 'admin';

export interface CurrentUser {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  companyId: string | null;
  companyName: string | null;
  companyType: CompanyType | null;
}

const ROLE_LABEL: Record<UserRole, string> = {
  owner: 'Владелец компании',
  manager: 'Менеджер',
  concierge: 'Консьерж QAJET',
  admin: 'Админ QAJET',
};

interface RoleRow {
  role: UserRole;
  company_id: string | null;
  companies: { name: string; type: CompanyType } | { name: string; type: CompanyType }[] | null;
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
      .select('role, company_id, companies(name, type)')
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
    companyId: roleResult.data.company_id,
    companyName: company?.name ?? null,
    companyType: company?.type ?? null,
  };
}

export function shellUserFrom(user: CurrentUser): { name: string; meta: string } {
  return { name: user.fullName, meta: user.companyName ?? ROLE_LABEL[user.role] };
}

/**
 * Роль в users (owner/manager/concierge/admin) не то же самое, что актёр
 * машины состояний заказа (agents.md §6, packages/engine/order): owner и
 * manager — это «buyer» ИЛИ «supplier» в зависимости от companies.type,
 * а не отдельное значение enum'а. Concierge/admin — staff, у них нет
 * company_id вообще.
 */
export function orderActorFor(user: CurrentUser): OrderActor {
  if (user.role === 'concierge' || user.role === 'admin') return user.role;
  return user.companyType === 'supplier' ? 'supplier' : 'buyer';
}

/**
 * Гейт для *-layout.tsx каждой роли — найдено при review PR (P1): ни один
 * layout не проверял, что залогиненный пользователь действительно этой
 * роли. RLS всё равно не даёт увидеть чужие данные (staffOnly/company_id-
 * подзапросы), но это не повод не гейтить сам маршрут — буквально любой
 * покупатель мог зайти на /admin и увидеть пустую, но настоящую админку.
 * Тот же принцип, что уже был в /metrics (requireAdminSession()).
 */
export async function requireActor(expected: OrderActor): Promise<CurrentUser> {
  const user = await requireCurrentUser();
  if (orderActorFor(user) !== expected) redirect('/');
  return user;
}
