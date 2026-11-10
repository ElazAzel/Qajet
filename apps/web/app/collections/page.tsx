import type { Metadata } from 'next';
import Link from 'next/link';
import { PROGRAMS } from '../lib/program-brief';
import { BriefBuilder } from './_brief-builder';

export const metadata: Metadata = {
  title: 'Собрать закупку: мерч и корпоративные наборы — QAJET',
  description:
    'Подготовьте закупку под число получателей, бюджет и дату. Welcome-наборы, мерч для мероприятий и подарки команде с сопровождением QAJET.',
};
export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string }>;
}) {
  const requested = (await searchParams).program;
  const program = PROGRAMS.find((p) => p.id === requested) ?? PROGRAMS[0];
  return (
    <div className="min-h-screen bg-page text-ink">
      <header className="mx-auto flex h-20 max-w-6xl items-center justify-between border-rule border-b px-5 sm:px-8">
        <Link href="/" className="text-xl font-extrabold tracking-wide">
          QAJET
        </Link>
        <Link href="/login" className="text-fine font-semibold text-purple">
          Войти в кабинет
        </Link>
      </header>
      <main className="mx-auto max-w-6xl px-5 pt-10 pb-20 sm:px-8 sm:pt-16">
        <p className="text-fine font-semibold text-purple">Мерч, наборы и полиграфия для бизнеса</p>
        <h1 className="mt-3 max-w-3xl text-3xl leading-tight font-extrabold tracking-tight text-balance sm:text-5xl">
          Соберите закупку под вашу задачу
        </h1>
        <p className="mt-4 max-w-2xl text-base text-muted">
          Повод, количество, бюджет и дата. Мы подготовим состав для согласования, а QAJET уточнит
          детали и соберёт предложения поставщиков.
        </p>
        <BriefBuilder initialProgram={program.id} />
      </main>
      <footer className="border-rule border-t px-5 py-6 text-center text-fine text-muted">
        QAJET · Внешний отдел закупок для бизнеса
      </footer>
    </div>
  );
}
