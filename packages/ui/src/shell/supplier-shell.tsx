import type { ReactNode } from 'react';
import { ShellLayout, type ShellNavItem, type ShellUser } from './shell-layout';

/**
 * Оболочка поставщика — §10, §12: тот же сайдбар + хедер, что у покупателя
 * и консьержа. Мобильный сценарий (ответ по RFQ с телефона) закрыт общей
 * нижней таб-навигацией `ShellLayout`, а не отдельной вёрсткой.
 */
export interface SupplierShellProps {
  children: ReactNode;
  navItems: ShellNavItem[];
  user: ShellUser;
  promo?: ReactNode;
}

export function SupplierShell({ children, navItems, user, promo }: SupplierShellProps) {
  return (
    <ShellLayout navItems={navItems} user={user} promo={promo}>
      {children}
    </ShellLayout>
  );
}
