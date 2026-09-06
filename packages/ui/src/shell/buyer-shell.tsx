import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

/**
 * Оболочка покупателя — §10, §12: верхняя навигация, широкий контент,
 * без левого рельса. Покупатель заходит эпизодически и должен сразу
 * понять, где решение — поэтому воздух важнее плотности.
 */
export interface BuyerShellProps {
  children: ReactNode;
  nav: ReactNode;
  header?: ReactNode;
}

export function BuyerShell({ children, nav, header }: BuyerShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <header className="border-b border-rule bg-surface">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">{nav}</div>
      </header>
      {header && <div className="border-b border-rule bg-surface">{header}</div>}
      <main className={cn('mx-auto w-full max-w-6xl flex-1 px-6 py-8')}>{children}</main>
    </div>
  );
}
