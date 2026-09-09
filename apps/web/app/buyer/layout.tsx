import { BuyerShell } from '@qajet/ui/shell';
import { FilePlus, ListChecks, MessageSquare, Repeat, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { requireActor, shellUserFrom } from '../lib/current-user';

const NAV_ITEMS = [
  { key: 'orders', href: '/buyer', label: 'Заказы', icon: <ListChecks size={18} /> },
  {
    key: 'new-request',
    href: '/buyer/requests/new',
    label: 'Новая заявка',
    icon: <FilePlus size={18} />,
  },
  {
    key: 'reorder',
    href: '/buyer/reorder',
    label: 'Повтор заказа',
    icon: <Repeat size={18} />,
  },
  {
    key: 'messages',
    href: '/buyer/messages',
    label: 'Сообщения',
    icon: <MessageSquare size={18} />,
  },
  { key: 'settings', href: '/buyer/settings', label: 'Настройки', icon: <Settings size={18} /> },
];
// «Команда» (agents.md §10 «Покупатель»: приглашение, лимиты, отзыв доступа)
// убрана из навигации — /buyer/team не существует, вела на 404. Экран не
// реализован; при реализации вернуть пункт сюда, не создавать новый.

export default async function BuyerLayout({ children }: { children: ReactNode }) {
  const user = await requireActor('buyer');
  return (
    <BuyerShell navItems={NAV_ITEMS} user={shellUserFrom(user)}>
      {children}
    </BuyerShell>
  );
}
