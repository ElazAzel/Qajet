import Link from 'next/link';
import { PasswordForm } from '../_password-form';
import { RecoveryRequestForm } from '../_recovery-form';

export const dynamic = 'force-dynamic';

export default async function RecoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; next?: string }>;
}) {
  const { mode, next } = await searchParams;
  const resetMode = mode === 'reset';
  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-6">
      <section className="w-full max-w-sm rounded-card border border-rule bg-surface p-6">
        <p className="text-micro tracking-wide text-muted uppercase">Доступ QAJET</p>
        <h1 className="mt-1 text-2xl font-extrabold text-ink">
          {resetMode ? 'Новый пароль' : 'Восстановление доступа'}
        </h1>
        <p className="mt-2 text-fine text-muted">
          {resetMode
            ? 'Придумайте новый пароль для рабочего кабинета.'
            : 'Укажите рабочий email — мы отправим одноразовую ссылку.'}
        </p>
        {resetMode ? <PasswordForm next={next ?? '/'} /> : <RecoveryRequestForm />}
        <Link href="/login" className="mt-4 block text-center text-fine font-semibold text-purple">
          Вернуться ко входу
        </Link>
      </section>
    </main>
  );
}
