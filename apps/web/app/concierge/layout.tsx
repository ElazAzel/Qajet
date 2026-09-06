import { ConciergeShell } from '@qajet/ui/shell';
import Link from 'next/link';
import type { ReactNode } from 'react';

const RAIL_ITEMS = [
  { href: '/concierge', label: 'Заказы', glyph: '☰' },
  { href: '/concierge/exceptions', label: 'Исключения', glyph: '!' },
  { href: '/concierge/templates', label: 'Шаблоны', glyph: '▤' },
];

export default function ConciergeLayout({ children }: { children: ReactNode }) {
  return (
    <ConciergeShell
      rail={RAIL_ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          title={item.label}
          className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] text-sm hover:bg-white/10"
        >
          {item.glyph}
        </Link>
      ))}
      list={
        <div className="p-4">
          <p className="text-micro tracking-wide text-muted uppercase">Доска заказов</p>
        </div>
      }
      detail={children}
    />
  );
}
