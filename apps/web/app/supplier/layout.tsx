import { SupplierShell } from '@qajet/ui/shell';
import { ClipboardList, Inbox, UserRound, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { requireActor, shellUserFrom } from '../lib/current-user';

const NAV_ITEMS = [
  { key: 'inbox', label: 'RFQ', href: '/supplier', icon: <Inbox size={18} /> },
  { key: 'orders', label: 'Заказы', href: '/supplier#orders', icon: <ClipboardList size={18} /> },
  { key: 'messages', label: 'Сообщения', href: '/supplier/messages', icon: <Inbox size={18} /> },
  { key: 'profile', label: 'Профиль', href: '/supplier/profile', icon: <UserRound size={18} /> },
  { key: 'team', label: 'Команда', href: '/supplier/team', icon: <Users size={18} /> },
];

export default async function SupplierLayout({ children }: { children: ReactNode }) {
  const user = await requireActor('supplier');
  return (
    <SupplierShell navItems={NAV_ITEMS} user={shellUserFrom(user)}>
      {children}
    </SupplierShell>
  );
}
