import type { ReactNode } from 'react';
import { ShellLayout, type ShellNavItem, type ShellUser } from './shell-layout';

/**
 * Оболочка покупателя — §10, §12: сайдбар + хедер, как у остальных ролей.
 * Единственная роль с поиском и ⌘K в хедере — покупатель ищет заказы и
 * поставщиков чаще, чем переключает разделы.
 */
export interface BuyerShellProps {
  children: ReactNode;
  navItems: ShellNavItem[];
  user: ShellUser;
  promo?: ReactNode;
}

export function BuyerShell({ children, navItems, user, promo }: BuyerShellProps) {
  return (
    <ShellLayout
      navItems={navItems}
      user={user}
      promo={promo}
      search={{ placeholder: 'Заказ, поставщик, позиция…', shortcut: '⌘K' }}
    >
      {children}
    </ShellLayout>
  );
}
