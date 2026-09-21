import { Reveal, Stamp } from '@qajet/ui/motion';
import { Card } from '@qajet/ui/primitives';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireActor } from '../../lib/current-user';
import { UserCreateForm, UserRow } from './_user-actions';

/**
 * Учётные записи — единственное место, где админ заводит людей, закрывает
 * доступ уволенным и исправляет роли.
 *
 * Блокировка и правка идут через RPC с проверкой внутри базы (миграция 0056),
 * поэтому страница не решает, кому что можно: она показывает и отправляет.
 */

const ROLE_LABEL: Record<string, string> = {
  owner: 'Владелец компании',
  manager: 'Сотрудник компании',
  concierge: 'Консьерж QAJET',
  admin: 'Админ QAJET',
};

interface Row {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  company_id: string | null;
  companies: { name: string } | { name: string }[] | null;
}

export default async function AdminUsersPage() {
  const me = await requireActor('admin');
  const supabase = await createSupabaseServerClient();

  const [{ data: userRows }, { data: companyRows }] = await Promise.all([
    supabase
      .from('users')
      .select('id, email, full_name, role, is_active, company_id, companies(name)')
      .order('created_at', { ascending: false }),
    supabase
      .from('companies')
      .select('id, name, type')
      .eq('is_active', true)
      .order('name', { ascending: true }),
  ]);

  const users = (userRows ?? []) as unknown as Row[];
  const staff = users.filter((user) => !user.company_id);
  const employees = users.filter((user) => user.company_id);
  const activeAdmins = users.filter((u) => u.role === 'admin' && u.is_active).length;

  const render = (list: Row[]) =>
    list.map((user) => {
      const company = Array.isArray(user.companies) ? user.companies[0] : user.companies;
      return (
        <UserRow
          key={user.id}
          id={user.id}
          fullName={user.full_name}
          email={user.email}
          role={user.role}
          roleLabel={ROLE_LABEL[user.role] ?? user.role}
          isActive={user.is_active}
          companyName={company?.name ?? null}
          isSelf={user.id === me.id}
          // Последнего активного админа база не даст ни заблокировать, ни
          // понизить. Говорим об этом заранее, а не отказом после нажатия.
          isLastAdmin={user.role === 'admin' && user.is_active && activeAdmins === 1}
        />
      );
    });

  return (
    <div className="flex flex-col gap-6 px-4 py-5 sm:px-6 sm:py-6">
      <Reveal>
        <h1 className="text-2xl font-extrabold text-ink">Учётные записи</h1>
        <p className="mt-1.5 text-fine text-muted">
          {users.length} человек · {activeAdmins}{' '}
          {activeAdmins === 1 ? 'активный админ' : 'активных админа'}
        </p>
      </Reveal>

      <Reveal delay={0.08}>
        <Card padding="sm">
          <p className="text-sm font-bold text-ink">Завести учётную запись</p>
          <p className="mt-1 mb-4 text-fine text-muted">
            Человек получит письмо со ссылкой и задаст пароль сам. Пароль здесь не задаётся.
          </p>
          <UserCreateForm companies={companyRows ?? []} />
        </Card>
      </Reveal>

      <Reveal delay={0.12}>
        <Card padding="sm">
          <p className="mb-1 text-sm font-bold text-ink">Персонал QAJET</p>
          <p className="mb-4 text-fine text-muted">Консьержи и админы. Вне компаний.</p>
          {staff.length === 0 ? (
            <p className="text-fine text-muted">Пока никого.</p>
          ) : (
            <ul className="flex flex-col">{render(staff)}</ul>
          )}
        </Card>
      </Reveal>

      <Reveal delay={0.16}>
        <Card padding="sm">
          <p className="mb-1 text-sm font-bold text-ink">Сотрудники компаний</p>
          <p className="mb-4 text-fine text-muted">Покупатели и поставщики.</p>
          {employees.length === 0 ? (
            <p className="text-fine text-muted">Пока никого.</p>
          ) : (
            <ul className="flex flex-col">{render(employees)}</ul>
          )}
        </Card>
      </Reveal>

      <Reveal delay={0.2}>
        <p className="text-fine text-muted">
          Блокировка не удаляет запись: все действия человека остаются в истории заказов.{' '}
          <Stamp tone="neutral">Так и задумано</Stamp>
        </p>
      </Reveal>
    </div>
  );
}
