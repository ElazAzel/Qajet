import { Reveal } from '@qajet/ui/motion';
import Link from 'next/link';

/**
 * Страница входа. Supabase Auth и быстрый вход демо-аккаунтами (§13) —
 * фаза 1: форма без бэкенда пока честно объясняет свой статус, а не
 * притворяется рабочей кнопкой в никуда.
 */
export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6">
      <Reveal className="w-full max-w-sm rounded-[var(--radius-overlay)] border border-rule bg-surface p-6">
        <h1 className="text-lg font-medium">Вход в QAJET</h1>
        <p className="mt-1 text-fine text-muted">
          Supabase Auth и быстрый вход демо-аккаунтами появятся в фазе «Данные и доступ».
        </p>

        <form className="mt-6 space-y-3" aria-disabled="true">
          <label className="block">
            <span className="text-fine text-muted">Email</span>
            <input
              type="email"
              disabled
              placeholder="buyer@demo.qajet.kz"
              className="mt-1 w-full rounded-[var(--radius-control)] border border-rule bg-paper px-3 py-2 text-sm disabled:opacity-60"
            />
          </label>
          <label className="block">
            <span className="text-fine text-muted">Пароль</span>
            <input
              type="password"
              disabled
              placeholder="••••••••"
              className="mt-1 w-full rounded-[var(--radius-control)] border border-rule bg-paper px-3 py-2 text-sm disabled:opacity-60"
            />
          </label>
          <button
            type="button"
            disabled
            className="w-full rounded-[var(--radius-control)] bg-accent px-4 py-2 text-sm font-medium text-ink opacity-50"
          >
            Войти
          </button>
        </form>

        <p className="mt-6 text-micro text-muted">
          Пока смотрите оболочки ролей напрямую:{' '}
          <Link href="/buyer" className="text-ink underline">
            покупатель
          </Link>
          ,{' '}
          <Link href="/concierge" className="text-ink underline">
            консьерж
          </Link>
          ,{' '}
          <Link href="/supplier" className="text-ink underline">
            поставщик
          </Link>
          ,{' '}
          <Link href="/admin" className="text-ink underline">
            админ
          </Link>
          .
        </p>
      </Reveal>
    </div>
  );
}
