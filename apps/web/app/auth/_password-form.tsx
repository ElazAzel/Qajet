'use client';

import { useActionState } from 'react';
import { setPassword } from './actions';

export function PasswordForm({ next }: { next?: string }) {
  const [error, formAction, pending] = useActionState(setPassword, null);
  return (
    <form action={formAction} className="mt-6 flex flex-col gap-3">
      <input type="hidden" name="next" value={next ?? '/'} />
      <label className="text-fine text-muted">
        Новый пароль
        <input
          type="password"
          name="password"
          minLength={8}
          required
          autoComplete="new-password"
          className="mt-1 w-full rounded-control border border-rule bg-page px-3 py-2 text-sm text-ink"
        />
      </label>
      <label className="text-fine text-muted">
        Повторите пароль
        <input
          type="password"
          name="confirmation"
          minLength={8}
          required
          autoComplete="new-password"
          className="mt-1 w-full rounded-control border border-rule bg-page px-3 py-2 text-sm text-ink"
        />
      </label>
      {error && <p className="text-fine text-signal">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-control bg-purple px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? 'Сохраняю…' : 'Сохранить пароль'}
      </button>
    </form>
  );
}
