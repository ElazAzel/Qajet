import { IBM_Plex_Mono, Onest } from 'next/font/google';

/**
 * next/font скачивает шрифты на этапе сборки и самостоятельно их хостит —
 * рантайм не делает ни одного запроса к Google. Это то же требование
 * «ноль внешних API-ключей» из agents.md §2, применённое к шрифтам.
 *
 * Onest — единственное семейство интерфейса (§12). IBM Plex Mono —
 * только для денежных колонок, количеств и номеров документов;
 * подключать его где-либо ещё запрещено дизайн-спекой.
 */
export const onest = Onest({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '700'],
  variable: '--font-onest',
  display: 'swap',
});

export const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});
