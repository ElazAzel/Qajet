import type { ReactNode } from 'react';
import { ShellLayout, type ShellNavItem, type ShellUser } from './shell-layout';

/**
 * Оболочка админа — §12: единственная роль с тёмным (`--ink`) сайдбаром
 * и лаймовым активным пунктом навигации. Структурно та же сборка
 * сайдбар+хедер, что у остальных ролей — админ не получает отдельный
 * визуальный язык, только инверсию тона.
 */
export interface AdminShellProps {
  children: ReactNode;
  navItems: ShellNavItem[];
  user: ShellUser;
}

export function AdminShell({ children, navItems, user }: AdminShellProps) {
  return (
    <ShellLayout navItems={navItems} user={user} tone="dark">
      {children}
    </ShellLayout>
  );
}
