'use client';

import { SupplierShell } from '@qajet/ui/shell';
import { BarChart3, Inbox, ListChecks, User } from 'lucide-react';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const TAB_DEFS = [
  { key: 'inbox', label: 'RFQ', href: '/supplier', icon: <Inbox size={20} /> },
  { key: 'orders', label: 'Заказы', href: '/supplier/orders', icon: <ListChecks size={20} /> },
  { key: 'growth', label: 'Рост', href: '/supplier/growth', icon: <BarChart3 size={20} /> },
  { key: 'profile', label: 'Профиль', href: '/supplier/profile', icon: <User size={20} /> },
] as const;

export default function SupplierLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const tabs = TAB_DEFS.map((tab) => ({
    ...tab,
    active: tab.href === '/supplier' ? pathname === tab.href : pathname.startsWith(tab.href),
  }));

  return <SupplierShell tabs={tabs}>{children}</SupplierShell>;
}
