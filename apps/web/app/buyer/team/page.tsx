import { Reveal, Stagger } from '@qajet/ui/motion';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { loadTeam } from '../../lib/buyer-team';
import { requireCurrentUser } from '../../lib/current-user';
import { MemberCard } from './_member-card';

/**
 * Команда и доступы — agents.md §10 «Покупатель»: лимиты согласования и
 * отзыв доступа. Экрана не существовало вовсе: пункт навигации был убран
 * как ведущий на 404, а лимит согласования жил колонкой в базе, которую
 * нельзя было ни увидеть, ни изменить из интерфейса.
 *
 * Приглашение сотрудника осознанно не реализовано — см. комментарий в
 * `apps/web/app/lib/actions/team-actions.ts`: завести пользователя значит
 * писать в `auth.users`, а это требует service-role-ключа, которого у
 * пользовательской сессии нет и быть не должно.
 */

export default async function BuyerTeamPage() {
  const user = await requireCurrentUser();
  const supabase = await createSupabaseServerClient();
  const members = await loadTeam(supabase);
  const canManage = user.role === 'owner';

  return (
    <div>
      <Reveal className="mb-6">
        <h1 className="text-3xl font-extrabold">Команда и доступы</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Лимит согласования ограничивает сумму заказа, которую сотрудник может утвердить сам.
          {canManage
            ? ' Менять лимиты и права может владелец компании — то есть вы.'
            : ' Менять лимиты и права может только владелец компании.'}
        </p>
      </Reveal>

      <Stagger
        startIndex={1}
        as="div"
        className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
      >
        {members.map((member) => (
          <MemberCard
            key={member.id}
            member={member}
            canManage={canManage}
            isSelf={member.id === user.id}
          />
        ))}
      </Stagger>

      <Reveal className="mt-6 rounded-card border border-rule bg-surface p-5">
        <p className="text-fine font-semibold">Пригласить сотрудника</p>
        <p className="mt-1 max-w-2xl text-fine text-muted">
          Новый сотрудник заводится через QAJET: напишите в поддержку или обсудите это в треде
          любого заказа — самостоятельное создание учётной записи из интерфейса покупателя не
          предусмотрено.
        </p>
      </Reveal>
    </div>
  );
}
