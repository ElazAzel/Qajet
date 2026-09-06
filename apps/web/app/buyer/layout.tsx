import { BuyerShell } from '@qajet/ui/shell';
import Link from 'next/link';
import type { ReactNode } from 'react';

const NAV_ITEMS = [
  { href: '/buyer', label: 'Заказы' },
  { href: '/buyer/requests/new', label: 'Новая заявка' },
  { href: '/buyer/team', label: 'Команда' },
];

export default function BuyerLayout({ children }: { children: ReactNode }) {
  return (
    <BuyerShell
      nav={
        <>
          <span className="text-sm font-medium">QAJET</span>
          <div className="flex items-center gap-6">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-fine text-muted hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </>
      }
    >
      {children}
    </BuyerShell>
  );
}
