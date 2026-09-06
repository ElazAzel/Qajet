'use client';

import { Reveal } from '@qajet/ui/motion';
import { useActionState } from 'react';
import { quickSignIn, signIn } from './actions';

const DEMO_ACCOUNTS = [
  { email: 'buyer@demo.qajet.kz', label: 'Покупатель' },
  { email: 'supplier@demo.qajet.kz', label: 'Поставщик' },
  { email: 'concierge@demo.qajet.kz', label: 'Консьерж' },
  { email: 'admin@demo.qajet.kz', label: 'Админ' },
] as const;

export function LoginForm() {
  const [error, formAction, isPending] = useActionState(signIn, null);

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6">
      <Reveal className="w-full max-w-sm rounded-[var(--radius-overlay)] border border-rule bg-surface p-6">
        <h1 className="text-lg font-medium">Вход в QAJET</h1>
        <p className="mt-1 text-fine text-muted">Один закупочный партнёр. Один вход.</p>

        <form action={formAction} className="mt-6 space-y-3">
          <label className="block">
            <span className="text-fine text-muted">Email</span>
            <input
              type="email"
              name="email"
              required
              placeholder="buyer@demo.qajet.kz"
              className="mt-1 w-full rounded-[var(--radius-control)] border border-rule bg-paper px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-fine text-muted">Пароль</span>
            <input
              type="password"
              name="password"
              required
              placeholder="••••••••"
              className="mt-1 w-full rounded-[var(--radius-control)] border border-rule bg-paper px-3 py-2 text-sm"
            />
          </label>

          {error ? <p className="text-fine text-signal">{error}</p> : null}

          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-[var(--radius-control)] bg-accent px-4 py-2 text-sm font-medium text-ink disabled:opacity-60"
          >
            {isPending ? 'Входим…' : 'Войти'}
          </button>
        </form>

        {process.env.NODE_ENV !== 'production' && (
          <div className="mt-6 border-t border-rule pt-4">
            <p className="text-micro text-muted">Быстрый вход демо-аккаунтами (только dev):</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {DEMO_ACCOUNTS.map((account) => (
                <form key={account.email} action={quickSignIn.bind(null, account.email)}>
                  <button
                    type="submit"
                    className="w-full rounded-[var(--radius-control)] border border-rule px-3 py-1.5 text-fine hover:bg-paper"
                  >
                    {account.label}
                  </button>
                </form>
              ))}
            </div>
          </div>
        )}
      </Reveal>
    </div>
  );
}
