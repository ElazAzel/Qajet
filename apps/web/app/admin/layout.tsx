import { AdminShell } from '@qajet/ui/shell';
import {
  Building2,
  Gauge,
  Landmark,
  LineChart,
  Mail,
  Scale,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { requireActor, shellUserFrom } from '../lib/current-user';

/**
 * Админ получает ту же оболочку сайдбар+хедер, что и остальные роли, но
 * с тёмным сайдбаром и лаймовым активным пунктом (§12) — единственная
 * инверсия тона во всём продукте.
 *
 * Финансовые факты, проверка поставщиков и outbox подключены отдельными
 * экранами: админ видит операционный журнал, но не может подменить им
 * подтверждение денег или переход заказа.
 */
const NAV_ITEMS = [
  { key: 'verification', href: '/admin', label: 'Верификация', icon: <ShieldCheck size={18} /> },
  { key: 'companies', href: '/admin/companies', label: 'Компании', icon: <Building2 size={18} /> },
  {
    key: 'learning',
    href: '/admin/learning',
    label: 'Как система учится',
    icon: <LineChart size={18} />,
  },
  { key: 'metrics', href: '/metrics', label: 'Метрики', icon: <Gauge size={18} /> },
  { key: 'finance', href: '/admin/finance', label: 'Финансы', icon: <Landmark size={18} /> },
  { key: 'disputes', href: '/admin/disputes', label: 'Споры', icon: <Scale size={18} /> },
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
