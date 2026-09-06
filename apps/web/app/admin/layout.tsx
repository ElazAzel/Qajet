import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * §12 явно называет три разные оболочки — покупатель, консьерж, поставщик.
 * Админ отдельной оболочки не получает: это тоже внутренний инструмент
 * QAJET, поэтому берётся тот же плотный, табличный характер, что и у
 * консьержа, но без рельса — админ не проводит здесь весь день на одном
 * заказе, а переключается между разделами настроек.
 */
const SECTIONS = [
  { href: '/admin', label: 'Верификация' },
  { href: '/admin/settings', label: 'Настройки' },
  { href: '/admin/finance', label: 'Финансы' },
  { href: '/admin/learning', label: 'Как система учится' },
  { href: '/admin/disputes', label: 'Споры' },
  { href: '/admin/outbox', label: 'Outbox' },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="border-b border-rule bg-ink text-paper">
        <div className="mx-auto flex h-12 max-w-6xl items-center gap-6 px-6 text-fine">
          <span className="font-medium">QAJET · Админ</span>
          <nav className="flex gap-5">
            {SECTIONS.map((section) => (
              <Link
                key={section.href}
                href={section.href}
                className="text-paper/70 hover:text-paper"
              >
                {section.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
