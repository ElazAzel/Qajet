'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { useRouter } from 'next/navigation';
import { assignSupplierRfq } from '../lib/actions/assignment-actions';
import type { SupplierTeamMemberOption } from '../lib/supplier-home';

export function RfqAssignment({
  rfqId,
  assignedUserId,
  assignedUserName,
  members,
  canManage,
}: {
  rfqId: string;
  assignedUserId: string | null;
  assignedUserName: string | null;
  members: SupplierTeamMemberOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const { run, pending, error } = useAsyncAction(assignSupplierRfq, () => router.refresh());

  if (!canManage) {
    return (
      <p className="text-micro text-muted">
        {assignedUserName ? `Ответственный: ${assignedUserName}` : 'Ответственный не назначен'}
      </p>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <label className="text-micro text-muted">
        <span className="sr-only">Ответственный сотрудник</span>
        <select
          value={assignedUserId ?? ''}
          disabled={pending}
          onChange={(event) => run(rfqId, event.target.value || null)}
          aria-label="Ответственный сотрудник"
          className="max-w-44 rounded-control border border-rule bg-surface px-2 py-1 text-micro text-ink"
        >
          <option value="">Без назначения</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.fullName} · {member.role === 'owner' ? 'owner' : 'manager'}
            </option>
          ))}
        </select>
      </label>
      {error && <span className="max-w-44 text-micro text-signal">{error}</span>}
    </div>
  );
}
