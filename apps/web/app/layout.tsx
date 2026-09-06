import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { onest, plexMono } from './fonts';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'QAJET — внешний отдел закупок',
    template: '%s · QAJET',
  },
  description:
    'Одна задача. Согласованный бюджет. Один закупочный партнёр. ' +
    'QAJET сравнивает не строки прайса, а целые исполнимые варианты решения закупочной задачи.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'QAJET',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#edefea' },
    { media: '(prefers-color-scheme: dark)', color: '#0c1b22' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className={`${onest.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
