'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { Button } from '@qajet/ui/primitives';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { inviteTeamMember } from '../../lib/actions/team-actions';

const inputClass =
  'w-full rounded-control border border-transparent bg-page px-3 py-2 text-sm text-ink placeholder:text-muted focus-visible:border-purple';

export function InviteForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [limit, setLimit] = useState('');
  const { run, pending, error } = useAsyncAction(inviteTeamMember, () => router.refresh());

  function submit() {
    run({
      email,
      fullName,
      approvalLimitKzt: limit.trim() === '' ? null : Number(limit),
    });
  }

  return (
    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_180px_auto] sm:items-end">
      <label>
        <span className="mb-1 block text-micro font-semibold text-muted">Имя</span>
        <input
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          placeholder="Алия Садыкова"
          className={inputClass}
        />
      </label>
      <label>
        <span className="mb-1 block text-micro font-semibold text-muted">Email</span>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="aliya@company.kz"
          className={inputClass}
        />
      </label>
      <label>
        <span className="mb-1 block text-micro font-semibold text-muted">Лимит, ₸</span>
        <input
          type="number"
          min={0}
          value={limit}
          onChange={(event) => setLimit(event.target.value)}
          placeholder="Без лимита"
          className={inputClass}
        />
      </label>
      <Button loading={pending} onClick={submit}>
        {pending ? 'Отправляю…' : 'Пригласить'}
      </Button>
      {error && <p className="text-fine text-signal sm:col-span-4">{error}</p>}
    </div>
  );
}
