import { BuyerShell } from '@qajet/ui/shell';
import { FilePlus, ListChecks, Users } from 'lucide-react';
import type { ReactNode } from 'react';

const NAV_ITEMS = [
  { key: 'orders', href: '/buyer', label: 'Заказы', icon: <ListChecks size={18} />, active: true },
  {
    key: 'new-request',
    href: '/buyer/requests/new',
    label: 'Новая заявка',
    icon: <FilePlus size={18} />,
  },
  { key: 'team', href: '/buyer/team', label: 'Команда', icon: <Users size={18} /> },
];

export default function BuyerLayout({ children }: { children: ReactNode }) {
  return (
    <BuyerShell navItems={NAV_ITEMS} user={{ name: 'Покупатель', meta: 'buyer@demo.qajet.kz' }}>
      {children}
    </BuyerShell>
  );
}
