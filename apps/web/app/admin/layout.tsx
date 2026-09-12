import { AdminShell } from '@qajet/ui/shell';
import { Gauge, LineChart, Mail, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { requireActor, shellUserFrom } from '../lib/current-user';

/**
 * Админ получает ту же оболочку сайдбар+хедер, что и остальные роли, но
 * с тёмным сайдбаром и лаймовым активным пунктом (§12) — единственная
 * инверсия тона во всём продукте.
 *
 * Финансовая сверка и споры остаются отдельными будущими контурами, а
 * outbox подключён здесь как dev-журнал исходящих уведомлений.
 */
const NAV_ITEMS = [
  { key: 'verification', href: '/admin', label: 'Верификация', icon: <ShieldCheck size={18} /> },
  {
    key: 'learning',
    href: '/admin/learning',
    label: 'Как система учится',
    icon: <LineChart size={18} />,
  },
  { key: 'metrics', href: '/metrics', label: 'Метрики', icon: <Gauge size={18} /> },
  {
    key: 'settings',
    href: '/admin/settings',
    label: 'Параметры',
    icon: <SlidersHorizontal size={18} />,
  },
  { key: 'outbox', href: '/admin/outbox', label: 'Исходящие', icon: <Mail size={18} /> },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireActor('admin');
  return (
    <AdminShell navItems={NAV_ITEMS} user={shellUserFrom(user)}>
      {children}
    </AdminShell>
  );
}
