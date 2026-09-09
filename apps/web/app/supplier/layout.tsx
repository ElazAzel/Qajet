import { SupplierShell } from '@qajet/ui/shell';
import { Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import { requireActor, shellUserFrom } from '../lib/current-user';

// «Заказы»/«Рост»/«Профиль» (agents.md §10 «Поставщик») убраны из
// навигации — /supplier/orders, /supplier/growth, /supplier/profile не
// реализованы, вели на 404. Дашборд роста и статус заказов пока частично
// покрыты плитками на /supplier. При реализации экранов вернуть пункты
// сюда, не создавать новые.
const NAV_ITEMS = [{ key: 'inbox', label: 'RFQ', href: '/supplier', icon: <Inbox size={18} /> }];

export default async function SupplierLayout({ children }: { children: ReactNode }) {
  const user = await requireActor('supplier');
  return (
    <SupplierShell navItems={NAV_ITEMS} user={shellUserFrom(user)}>
      {children}
    </SupplierShell>
  );
}
