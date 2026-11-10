'use client';

import { Reveal } from '@qajet/ui/motion';
import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import {
  PROGRAM_BRIEF_STORAGE_KEY,
  parseProgramBrief,
  programBriefQuery,
} from '../lib/program-brief';
import { quickSignIn, signIn } from './actions';

const DEMO_ACCOUNTS = [
  { email: 'buyer@demo.qajet.kz', label: 'Покупатель' },
  { email: 'supplier@demo.qajet.kz', label: 'Поставщик' },
  { email: 'concierge@demo.qajet.kz', label: 'Консьерж' },
  { email: 'admin@demo.qajet.kz', label: 'Админ' },
] as const;

export function LoginForm({ resumeProgramBrief = false }: { resumeProgramBrief?: boolean }) {
  const [error, formAction, isPending] = useActionState(signIn, null);
  const [brief, setBrief] = useState<string | null>(null);
  useEffect(() => {
    if (!resumeProgramBrief) return;
    try {
      const stored = parseProgramBrief(sessionStorage.getItem(PROGRAM_BRIEF_STORAGE_KEY));
      if (stored) setBrief(programBriefQuery(stored));
    } catch {
      /* An unavailable browser store does not prevent sign-in. */
    }
  }, [resumeProgramBrief]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-6">
      <Reveal className="w-full max-w-sm rounded-card border border-rule bg-surface p-6">
        <h1 className="text-lg font-extrabold text-ink">Вход в QAJET</h1>
        <p className="mt-1 text-fine text-muted">Один закупочный партнёр. Один вход.</p>
        {brief && (
          <p className="mt-3 text-fine text-purple">
            После входа откроется подготовленная заявка. Перед отправкой вы проверите её состав.
          </p>
        )}

        <form action={formAction} className="mt-6 space-y-3">
          {brief && <input type="hidden" name="brief" value={brief} />}
          <label className="block">
            <span className="text-fine text-muted">Email</span>
            <input
              type="email"
              name="email"
              required
              placeholder="buyer@demo.qajet.kz"
              className="mt-1 w-full rounded-control border border-rule bg-page px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-fine text-muted">Пароль</span>
            <input
              type="password"
              name="password"
              required
              placeholder="••••••••"
              className="mt-1 w-full rounded-control border border-rule bg-page px-3 py-2 text-sm"
            />
          </label>

          {error ? <p className="text-fine text-signal">{error}</p> : null}

          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-control bg-purple px-4 py-2 text-sm font-semibold text-white hover:bg-purple/90 disabled:opacity-60"
          >
            {isPending ? 'Входим…' : 'Войти'}
          </button>
        </form>

        <Link
          href="/auth/recover"
          className="mt-3 block text-center text-fine font-semibold text-purple"
        >
          Забыли пароль?
        </Link>

        {process.env.NODE_ENV !== 'production' && (
          <div className="mt-6 border-t border-rule pt-4">
            <p className="text-micro text-muted">Быстрый вход демо-аккаунтами (только dev):</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {DEMO_ACCOUNTS.map((account) => (
                <form key={account.email} action={quickSignIn.bind(null, account.email)}>
                  <button
                    type="submit"
                    className="w-full rounded-control border border-rule px-3 py-1.5 text-fine hover:bg-page"
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
