import { AdminShell } from '@qajet/ui/shell';
import {
  Building2,
  Landmark,
  LineChart,
  Mail,
  Scale,
  ShieldCheck,
  SlidersHorizontal,
  Users,
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
  {
    key: 'verification',
    href: '/admin',
    label: 'Верификация',
    shortLabel: 'Проверка',
    icon: <ShieldCheck size={18} />,
  },
  { key: 'companies', href: '/admin/companies', label: 'Компании', icon: <Building2 size={18} /> },
  {
    key: 'learning',
    href: '/admin/learning',
    label: 'Как система учится',
    shortLabel: 'Обучение',
    icon: <LineChart size={18} />,
  },
  // «Метрики» убраны из меню: страница живёт вне оболочки админа и не имеет ни
  // одной ссылки назад — путь в один конец (аудит F8). Открыть её по-прежнему
  // можно прямым адресом /metrics. Место заняли «Учётные записи»: девятый пункт
  // вытолкнул бы за экран третью подпись на 375px, что закреплено тестом
  // доступности как известная граница.
  {
    key: 'users',
    href: '/admin/users',
    label: 'Учётные записи',
    shortLabel: 'Аккаунты',
    icon: <Users size={18} />,
  },
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
