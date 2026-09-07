import { AdminShell } from '@qajet/ui/shell';
import { Inbox, LineChart, Scale, Settings, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Админ получает ту же оболочку сайдбар+хедер, что и остальные роли, но
 * с тёмным сайдбаром и лаймовым активным пунктом (§12) — единственная
 * инверсия тона во всём продукте.
 */
const NAV_ITEMS = [
  {
    key: 'verification',
    href: '/admin',
    label: 'Верификация',
    icon: <ShieldCheck size={18} />,
    active: true,
  },
  { key: 'settings', href: '/admin/settings', label: 'Настройки', icon: <Settings size={18} /> },
  { key: 'finance', href: '/admin/finance', label: 'Финансы', icon: <LineChart size={18} /> },
  {
    key: 'learning',
    href: '/admin/learning',
    label: 'Как система учится',
    icon: <LineChart size={18} />,
  },
  { key: 'disputes', href: '/admin/disputes', label: 'Споры', icon: <Scale size={18} /> },
  { key: 'outbox', href: '/admin/outbox', label: 'Outbox', icon: <Inbox size={18} /> },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminShell navItems={NAV_ITEMS} user={{ name: 'Админ', meta: 'admin@demo.qajet.kz' }}>
      {children}
    </AdminShell>
  );
}
