'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { Stamp } from '@qajet/ui/motion';
import { Button } from '@qajet/ui/primitives';
import { useState } from 'react';
import {
  type CreateUserInput,
  createUser,
  setUserActive,
  updateUser,
} from '../../lib/actions/user-actions';

const inputClass =
  'w-full rounded-control border border-rule bg-page px-3 py-2 text-sm text-ink placeholder:text-muted focus-visible:border-purple';

const ROLE_OPTIONS = [
  { value: 'manager', label: 'Сотрудник компании' },
  { value: 'owner', label: 'Владелец компании' },
  { value: 'concierge', label: 'Консьерж QAJET' },
  { value: 'admin', label: 'Админ QAJET' },
] as const;

const isStaffRole = (role: string) => role === 'concierge' || role === 'admin';

interface CompanyOption {
  id: string;
  name: string;
  type: string;
}

export function UserCreateForm({ companies }: { companies: CompanyOption[] }) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<string>('manager');
  const [companyId, setCompanyId] = useState('');
  const [done, setDone] = useState(false);

  const { run, pending, error } = useAsyncAction(
    (input: CreateUserInput) => createUser(input),
    () => {
      setDone(true);
      setEmail('');
      setFullName('');
      setCompanyId('');
    },
  );

  // Роль решает, нужна ли компания. Показываем только то, что имеет смысл:
  // персонал QAJET живёт вне компаний, и выбор компании для него — лишний шум.
  const needsCompany = !isStaffRole(role);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-micro font-semibold text-muted">Имя и фамилия</span>
          <input
            id="new-user-name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            className={inputClass}
            placeholder="Айгерим Сериковна"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-micro font-semibold text-muted">Email</span>
          <input
            id="new-user-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
            placeholder="name@company.kz"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-micro font-semibold text-muted">Роль</span>
          <select
            id="new-user-role"
            value={role}
            onChange={(event) => setRole(event.target.value)}
            className={inputClass}
          >
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {needsCompany && (
          <label className="block">
            <span className="mb-1 block text-micro font-semibold text-muted">Компания</span>
            <select
              id="new-user-company"
              value={companyId}
              onChange={(event) => setCompanyId(event.target.value)}
              className={inputClass}
            >
              <option value="">Выберите компанию</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          loading={pending}
          onClick={() => {
            setDone(false);
            run({
              email,
              fullName,
              role: role as CreateUserInput['role'],
              companyId: needsCompany ? companyId || null : null,
            });
          }}
        >
          {pending ? 'Отправляю приглашение…' : 'Пригласить'}
        </Button>
        {done && <p className="text-fine text-status-success-fg">Приглашение отправлено.</p>}
      </div>
      {error && (
        <p role="alert" className="text-fine text-signal">
          {error}
        </p>
      )}
    </div>
  );
}

export function UserRow({
  id,
  fullName,
  email,
  role,
  roleLabel,
  isActive,
  companyName,
  isSelf,
  isLastAdmin,
}: {
  id: string;
  fullName: string;
  email: string;
  role: string;
  roleLabel: string;
  isActive: boolean;
  companyName: string | null;
  isSelf: boolean;
  isLastAdmin: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(fullName);
  const [nextRole, setNextRole] = useState(role);

  const toggle = useAsyncAction((next: boolean) => setUserActive(id, next));
  const save = useAsyncAction(
    (input: { fullName: string; role: string }) =>
      updateUser(id, { fullName: input.fullName, role: input.role as never }),
    () => setEditing(false),
  );

  // Роль меняет и требование к компании. Смена между персоналом и сотрудником
  // компании запрещена в базе, поэтому и в списке не предлагаем невозможное.
  const roleChoices = ROLE_OPTIONS.filter((option) =>
    companyName ? !isStaffRole(option.value) : isStaffRole(option.value),
  );

  const blockReason = isSelf
    ? 'Нельзя закрыть доступ самому себе'
    : isLastAdmin
      ? 'Последний активный админ'
      : null;

  return (
    <li className="flex flex-col gap-2 border-rule border-b py-3 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">
            {fullName}
            {isSelf && <span className="ml-2 text-micro font-normal text-muted">это вы</span>}
          </p>
          <p className="truncate text-fine text-muted">
            {email} · {roleLabel}
            {companyName && ` · ${companyName}`}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Stamp tone={isActive ? 'success' : 'neutral'}>
            {isActive ? 'Доступ есть' : 'Заблокирован'}
          </Stamp>
          <Button variant="secondary" onClick={() => setEditing((value) => !value)}>
            {editing ? 'Отмена' : 'Изменить'}
          </Button>
          <Button
            variant="secondary"
            loading={toggle.pending}
            disabled={Boolean(blockReason) && isActive}
            onClick={() => toggle.run(!isActive)}
          >
            {isActive ? 'Заблокировать' : 'Вернуть доступ'}
          </Button>
        </div>
      </div>

      {blockReason && isActive && <p className="text-micro text-muted">{blockReason}</p>}

      {editing && (
        <div className="flex flex-wrap items-end gap-3 rounded-card bg-page p-3">
          <label className="block min-w-[200px] flex-1">
            <span className="mb-1 block text-micro font-semibold text-muted">Имя и фамилия</span>
            <input
              id={`name-${id}`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block min-w-[180px]">
            <span className="mb-1 block text-micro font-semibold text-muted">Роль</span>
            <select
              id={`role-${id}`}
              value={nextRole}
              onChange={(event) => setNextRole(event.target.value)}
              className={inputClass}
              disabled={isSelf}
            >
              {roleChoices.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="primary"
            loading={save.pending}
            onClick={() => save.run({ fullName: name, role: nextRole })}
          >
            Сохранить
          </Button>
        </div>
      )}

      {(toggle.error || save.error) && (
        <p role="alert" className="text-fine text-signal">
          {toggle.error ?? save.error}
        </p>
      )}
    </li>
  );
}
