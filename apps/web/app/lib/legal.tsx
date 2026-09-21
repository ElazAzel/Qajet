import Link from 'next/link';
import type { ReactNode } from 'react';
import { CONTACTS } from './contacts';

/**
 * Реквизиты оператора персональных данных.
 *
 * Здесь НЕТ выдуманных значений: юридического названия, БИН и адреса в проекте
 * нет, а подставить правдоподобные было бы хуже, чем честно их не показать.
 * Пока поле пустое, страница говорит, что реквизиты будут опубликованы. Заполнить
 * его — задача владельца (docs/legal/README.md).
 */
export const OPERATOR = {
  brand: 'QAJET',
  legalName: null as string | null,
  bin: null as string | null,
  address: null as string | null,
  /** Адрес для запросов о персональных данных. Лучше отдельный ящик, чем мессенджер. */
  privacyEmail: null as string | null,
};

export const LEGAL_REVISION = '21 сентября 2026';

export function LegalShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-page">
      <header className="border-b border-rule bg-surface">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-6">
          <Link href="/" className="text-sm font-extrabold tracking-wide">
            QAJET
          </Link>
          <Link href="/login" className="text-fine text-muted hover:text-ink">
            Войти
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-extrabold text-balance text-ink">{title}</h1>
        <p className="mt-2 text-fine text-muted">Редакция от {LEGAL_REVISION}</p>
        <div className="legal-prose mt-8 flex flex-col gap-8 text-sm text-ink">{children}</div>
      </main>
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-bold text-ink">{title}</h2>
      <div className="flex max-w-prose flex-col gap-3 leading-relaxed text-muted">{children}</div>
    </section>
  );
}

/** Реквизиты — только настоящие; при их отсутствии прямо говорим об этом. */
export function OperatorDetails() {
  const known = [
    OPERATOR.legalName && `Юридическое лицо: ${OPERATOR.legalName}`,
    OPERATOR.bin && `БИН: ${OPERATOR.bin}`,
    OPERATOR.address && `Адрес: ${OPERATOR.address}`,
  ].filter(Boolean) as string[];

  return (
    <>
      <p>
        Оператор персональных данных — {OPERATOR.brand}
        {known.length > 0 ? '.' : ' (сервис «внешний отдел закупок»).'}
      </p>
      {known.length > 0 ? (
        <ul className="list-disc pl-5">
          {known.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p>
          Полные реквизиты оператора публикуются здесь до начала обработки персональных данных
          клиентов по договору.
        </p>
      )}
      <p>
        Связаться по вопросам персональных данных:{' '}
        {OPERATOR.privacyEmail ? (
          <a href={`mailto:${OPERATOR.privacyEmail}`} className="text-purple hover:underline">
            {OPERATOR.privacyEmail}
          </a>
        ) : (
          <a
            href={CONTACTS.whatsapp}
            target="_blank"
            rel="noreferrer"
            className="text-purple hover:underline"
          >
            WhatsApp
          </a>
        )}
        .
      </p>
    </>
  );
}
