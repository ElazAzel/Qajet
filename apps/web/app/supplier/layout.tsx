import { SupplierShell } from '@qajet/ui/shell';
import { BarChart3, Inbox, ListChecks, User } from 'lucide-react';
import type { ReactNode } from 'react';
import { requireCurrentUser, shellUserFrom } from '../lib/current-user';

const NAV_ITEMS = [
  { key: 'inbox', label: 'RFQ', href: '/supplier', icon: <Inbox size={18} /> },
  { key: 'orders', label: 'Заказы', href: '/supplier/orders', icon: <ListChecks size={18} /> },
  { key: 'growth', label: 'Рост', href: '/supplier/growth', icon: <BarChart3 size={18} /> },
  { key: 'profile', label: 'Профиль', href: '/supplier/profile', icon: <User size={18} /> },
];

export default async function SupplierLayout({ children }: { children: ReactNode }) {
  const user = await requireCurrentUser();
  return (
    <SupplierShell navItems={NAV_ITEMS} user={shellUserFrom(user)}>
      {children}
    </SupplierShell>
  );
}
