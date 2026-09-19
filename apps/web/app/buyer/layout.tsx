import { BuyerShell } from '@qajet/ui/shell';
import { FilePlus, ListChecks, MessageSquare, Settings, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { requireActor, shellUserFrom } from '../lib/current-user';

// Пять пунктов вместо семи: на мобильной панели семь уезжали в горизонтальный
// скролл. «Повтор заказа» и «Аналитика» остались страницами, но ссылки на них
// живут на главной — это вторичные сценарии, а не разделы.
const NAV_ITEMS = [
  { key: 'orders', href: '/buyer', label: 'Закупки', icon: <ListChecks size={18} /> },
  {
    key: 'new-request',
    href: '/buyer/requests/new',
    label: 'Новая заявка',
    icon: <FilePlus size={18} />,
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
  const user = await requireActor('buyer');
  return (
    <BuyerShell navItems={NAV_ITEMS} user={shellUserFrom(user)}>
      {children}
    </BuyerShell>
  );
}
