import { ConciergeShell } from '@qajet/ui/shell';
import { AlertTriangle, LayoutGrid, LayoutList } from 'lucide-react';
import type { ReactNode } from 'react';

const NAV_ITEMS = [
  {
    key: 'orders',
    href: '/concierge',
    label: 'Заказы',
    icon: <LayoutList size={18} />,
    active: true,
  },
  {
    key: 'exceptions',
    href: '/concierge/exceptions',
    label: 'Исключения',
    icon: <AlertTriangle size={18} />,
  },
  {
    key: 'templates',
    href: '/concierge/templates',
    label: 'Шаблоны',
    icon: <LayoutGrid size={18} />,
  },
];

export default function ConciergeLayout({ children }: { children: ReactNode }) {
  return (
    <ConciergeShell
      navItems={NAV_ITEMS}
      user={{ name: 'Консьерж', meta: 'concierge@demo.qajet.kz' }}
      list={
        <div className="p-4">
          <p className="text-micro tracking-wide text-muted uppercase">Доска заказов</p>
        </div>
      }
      detail={children}
    />
  );
}
