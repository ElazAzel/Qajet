'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { Button } from '@qajet/ui/primitives';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { setTeamMemberAccess, setTeamMemberPermission } from '../../lib/actions/team-actions';
import { ROLE_LABEL, TEAM_PERMISSION_KEYS, type TeamMember } from '../../lib/buyer-team';

export function MemberCard({
  member,
  canManage,
  isSelf,
}: {
  member: TeamMember;
  canManage: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [limit, setLimit] = useState(
    member.approvalLimitKzt === null ? '' : String(member.approvalLimitKzt),
  );

  const saveLimit = useAsyncAction(async () => {
    const parsed = limit.trim() === '' ? null : Number(limit);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
      return { ok: false, error: 'Лимит должен быть неотрицательным числом' };
    }
    const result = await setTeamMemberAccess(member.id, parsed, member.isActive);
    if (result.ok) router.refresh();
    return result;
  });

  const toggleAccess = useAsyncAction(async () => {
    const result = await setTeamMemberAccess(member.id, member.approvalLimitKzt, !member.isActive);
    if (result.ok) router.refresh();
    return result;
  });

  return (
    <div className="rounded-card border border-rule bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {member.fullName}
            {isSelf && <span className="ml-2 text-fine font-normal text-muted">это вы</span>}
          </p>
          <p className="truncate text-fine text-muted">{member.email}</p>
          <p className="mt-1 text-fine text-muted">{ROLE_LABEL[member.role] ?? member.role}</p>
        </div>
        {!member.isActive && (
          <span className="rounded-control bg-status-danger-bg px-2 py-1 text-micro font-semibold text-signal">
            Доступ отозван
          </span>
        )}
      </div>

      <div className="mt-4 border-rule border-t pt-4">
        <p className="mb-2 text-fine font-semibold">Лимит согласования</p>
        {canManage ? (
          <div className="flex items-end gap-2">
            <label className="flex-1">
              <input
                type="number"
                min={0}
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                placeholder="Без лимита"
                aria-label={`Лимит согласования, ${member.fullName}`}
                className="w-full rounded-control bg-page px-3 py-2 text-sm text-ink"
              />
            </label>
            <Button
              variant="secondary"
              size="sm"
              loading={saveLimit.pending}
              onClick={saveLimit.run}
            >
              Сохранить
            </Button>
          </div>
        ) : (
          <p className="text-sm">
            {member.approvalLimitKzt === null
              ? 'Без лимита'
              : `${member.approvalLimitKzt.toLocaleString('ru-RU')} ₸`}
          </p>
        )}
        {saveLimit.error && <p className="mt-2 text-fine text-danger">{saveLimit.error}</p>}
      </div>

      <div className="mt-4 border-rule border-t pt-4">
        <p className="mb-2 text-fine font-semibold">Права</p>
        <ul className="flex flex-col gap-2">
          {TEAM_PERMISSION_KEYS.map((permission) => (
            <PermissionRow
              key={permission.key}
              memberId={member.id}
              label={permission.label}
              permissionKey={permission.key}
              enabled={member.permissions[permission.key] === true}
              canManage={canManage}
            />
          ))}
        </ul>
      </div>

      {canManage && !isSelf && (
        <div className="mt-4 border-rule border-t pt-4">
          <Button
            variant={member.isActive ? 'destructive' : 'secondary'}
            size="sm"
            loading={toggleAccess.pending}
            onClick={toggleAccess.run}
          >
            {member.isActive ? 'Отозвать доступ' : 'Вернуть доступ'}
          </Button>
          {toggleAccess.error && <p className="mt-2 text-fine text-danger">{toggleAccess.error}</p>}
        </div>
      )}
    </div>
  );
}

function PermissionRow({
  memberId,
  label,
  permissionKey,
  enabled,
  canManage,
}: {
  memberId: string;
  label: string;
  permissionKey: string;
  enabled: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const { run, pending, error } = useAsyncAction(async () => {
    const result = await setTeamMemberPermission(memberId, permissionKey, !enabled);
    if (result.ok) router.refresh();
    return result;
  });

  return (
    <li className="flex items-center justify-between gap-3">
      <span className="text-fine">{label}</span>
      {canManage ? (
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={label}
          disabled={pending}
          onClick={run}
          className={`h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
            enabled ? 'bg-purple' : 'bg-page'
          }`}
        >
          <span
            className={`block h-5 w-5 rounded-full bg-surface transition-transform ${
              enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
            }`}
          />
        </button>
      ) : (
        <span className="text-fine text-muted">{enabled ? 'есть' : 'нет'}</span>
      )}
      {error && <span className="text-fine text-danger">{error}</span>}
    </li>
  );
}
