import Link from 'next/link';
import { PasswordForm } from '../_password-form';

export const dynamic = 'force-dynamic';

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-6">
      <section className="w-full max-w-sm rounded-card border border-rule bg-surface p-6">
        <p className="text-micro tracking-wide text-muted uppercase">Доступ QAJET</p>
        <h1 className="mt-1 text-2xl font-extrabold text-ink">Установите пароль</h1>
        <p className="mt-2 text-fine text-muted">
          Ссылка одноразовая. После сохранения вы попадёте в свой рабочий кабинет.
        </p>
        {next ? <PasswordForm next={next} /> : <PasswordForm />}
        <Link href="/login" className="mt-4 block text-center text-fine font-semibold text-purple">
          Вернуться ко входу
        </Link>
      </section>
    </main>
  );
}
