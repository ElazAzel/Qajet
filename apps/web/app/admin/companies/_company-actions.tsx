'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { Button } from '@qajet/ui/primitives';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  type CompanyInput,
  createCompanyWithOwner,
  resendOwnerInvite,
  verifySupplierCompany,
} from '../../lib/actions/company-actions';

const inputClass =
  'w-full rounded-control border border-rule bg-page px-3 py-2 text-sm text-ink placeholder:text-muted';

export function CompanyCreateForm() {
  const router = useRouter();
  const [type, setType] = useState<CompanyInput['type']>('buyer');
  const [name, setName] = useState('');
  const [bin, setBin] = useState('');
  const [city, setCity] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerFullName, setOwnerFullName] = useState('');
  const { run, pending, error } = useAsyncAction(createCompanyWithOwner, () => router.refresh());
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2">
      <label className="text-fine text-muted">
        Тип
        <select
          value={type}
          onChange={(e) => setType(e.target.value as CompanyInput['type'])}
          className={inputClass}
        >
          <option value="buyer">Покупатель</option>
          <option value="supplier">Поставщик</option>
        </select>
      </label>
      <label className="text-fine text-muted">
        Название
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </label>
      <label className="text-fine text-muted">
        БИН
        <input
          inputMode="numeric"
          value={bin}
          onChange={(e) => setBin(e.target.value)}
          className={inputClass}
        />
      </label>
      <label className="text-fine text-muted">
        Город
        <input value={city} onChange={(e) => setCity(e.target.value)} className={inputClass} />
      </label>
      <label className="text-fine text-muted">
        Имя owner-а
        <input
          value={ownerFullName}
          onChange={(e) => setOwnerFullName(e.target.value)}
          className={inputClass}
        />
      </label>
      <label className="text-fine text-muted">
        Email owner-а
        <input
          type="email"
          value={ownerEmail}
          onChange={(e) => setOwnerEmail(e.target.value)}
          className={inputClass}
        />
      </label>
      <div className="md:col-span-2">
        <Button
          loading={pending}
          onClick={() => run({ type, name, bin, city, ownerEmail, ownerFullName })}
        >
          {pending ? 'Создаю…' : 'Создать компанию и отправить приглашение'}
        </Button>
        {error && <p className="mt-2 text-fine text-signal">{error}</p>}
      </div>
    </div>
  );
}

export function SupplierVerificationActions({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const verify = useAsyncAction(verifySupplierCompany, () => router.refresh());
  return (
    <div className="flex min-w-[250px] flex-col gap-2">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Комментарий"
        className={inputClass}
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          loading={verify.pending}
          onClick={() => verify.run(companyId, 'approved', note)}
        >
          Одобрить
        </Button>
        <Button
          size="sm"
          variant="destructive"
          loading={verify.pending}
          onClick={() => verify.run(companyId, 'rejected', note)}
        >
          Отклонить
        </Button>
      </div>
      {verify.error && <p className="text-fine text-signal">{verify.error}</p>}
    </div>
  );
}

export function ResendInviteButton({ userId }: { userId: string }) {
  const resend = useAsyncAction(resendOwnerInvite);
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={resend.pending}
      onClick={() => resend.run(userId)}
    >
      {resend.error ? 'Повторить' : 'Повторить приглашение'}
    </Button>
  );
}
