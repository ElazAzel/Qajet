'use client';

import { SupplierShell } from '@qajet/ui/shell';
import { BarChart3, Inbox, ListChecks, User } from 'lucide-react';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const NAV_DEFS = [
  { key: 'inbox', label: 'RFQ', href: '/supplier', icon: <Inbox size={18} /> },
  { key: 'orders', label: 'Заказы', href: '/supplier/orders', icon: <ListChecks size={18} /> },
  { key: 'growth', label: 'Рост', href: '/supplier/growth', icon: <BarChart3 size={18} /> },
  { key: 'profile', label: 'Профиль', href: '/supplier/profile', icon: <User size={18} /> },
] as const;

export default function SupplierLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const navItems = NAV_DEFS.map((item) => ({
    ...item,
    active: item.href === '/supplier' ? pathname === item.href : pathname.startsWith(item.href),
  }));

  return (
    <SupplierShell navItems={navItems} user={{ name: 'Поставщик', meta: 'supplier@demo.qajet.kz' }}>
      {children}
    </SupplierShell>
  );
}
