import { Reveal, Stagger } from '@qajet/ui/motion';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { InviteForm } from '../../buyer/team/_invite-form';
import { MemberCard } from '../../buyer/team/_member-card';
import { loadTeam } from '../../lib/buyer-team';
import { requireCurrentUser } from '../../lib/current-user';

export default async function SupplierTeamPage() {
  const user = await requireCurrentUser();
  const supabase = await createSupabaseServerClient();
  const members = await loadTeam(supabase);
  const canManage = user.role === 'owner';

  return (
    <div>
      <Reveal className="mb-6">
        <h1 className="text-3xl font-extrabold">Команда и доступы</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Owner поставщика управляет сотрудниками и передаёт им назначенные RFQ и заказы. История
          действий сохраняется за исходным пользователем.
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
          Новый сотрудник получит роль менеджера и сможет работать только в этой компании.
        </p>
        {canManage ? (
          <InviteForm />
        ) : (
          <p className="mt-3 text-fine text-muted">Приглашать может только владелец компании.</p>
        )}
      </Reveal>
    </div>
  );
}
