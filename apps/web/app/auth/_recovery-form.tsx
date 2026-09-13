'use client';

import { useActionState } from 'react';
import { requestPasswordReset } from './actions';

export function RecoveryRequestForm() {
  const [error, formAction, pending] = useActionState(requestPasswordReset, null);
  return (
    <form action={formAction} className="mt-6 flex flex-col gap-3">
      <label className="text-fine text-muted">
        Рабочий email
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          className="mt-1 w-full rounded-control border border-rule bg-page px-3 py-2 text-sm text-ink"
        />
      </label>
      {error ? (
        <p className="text-fine text-signal">{error}</p>
      ) : (
        <p className="text-fine text-muted">Если адрес зарегистрирован, на него придёт письмо.</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-control bg-purple px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? 'Отправляю…' : 'Отправить ссылку'}
      </button>
    </form>
  );
}
