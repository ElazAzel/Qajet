import { BuyerShell } from '@qajet/ui/shell';
import { Building2, FilePlus, ListChecks, MessageSquare, Settings, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { requireCurrentUser, shellUserFrom } from '../lib/current-user';

const NAV_ITEMS = [
  { key: 'orders', href: '/buyer', label: 'Заказы', icon: <ListChecks size={18} /> },
  {
    key: 'new-request',
    href: '/buyer/requests/new',
    label: 'Новая заявка',
    icon: <FilePlus size={18} />,
  },
  {
    key: 'suppliers',
    href: '/buyer/suppliers',
    label: 'Поставщики',
    icon: <Building2 size={18} />,
  },
  {
    key: 'messages',
    href: '/buyer/messages',
    label: 'Сообщения',
    icon: <MessageSquare size={18} />,
  },
  { key: 'team', href: '/buyer/team', label: 'Команда', icon: <Users size={18} /> },
  { key: 'settings', href: '/buyer/settings', label: 'Настройки', icon: <Settings size={18} /> },
];

export default async function BuyerLayout({ children }: { children: ReactNode }) {
  const user = await requireCurrentUser();
  return (
    <BuyerShell navItems={NAV_ITEMS} user={shellUserFrom(user)}>
      {children}
    </BuyerShell>
  );
}
