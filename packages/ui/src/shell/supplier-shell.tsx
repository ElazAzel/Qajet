import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

/**
 * Оболочка поставщика — §10, §12: мобильный сценарий первичен, поставщик
 * отвечает с телефона. Нижние табы, а не верхнее меню — большой палец
 * должен дотягиваться без перехвата телефона второй рукой.
 */
export interface SupplierTab {
  key: string;
  label: string;
  icon: ReactNode;
  href: string;
  active?: boolean;
  badge?: number;
}

export interface SupplierShellProps {
  children: ReactNode;
  tabs: SupplierTab[];
}

export function SupplierShell({ children, tabs }: SupplierShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-paper" style={{ paddingTop: 'var(--safe-top)' }}>
      <main className="flex-1 overflow-y-auto pb-20">{children}</main>
      <nav
        className="fixed inset-x-0 bottom-0 flex border-t border-rule bg-surface"
        style={{ paddingBottom: 'var(--safe-bottom)' }}
      >
        {tabs.map((tab) => (
          <a
            key={tab.key}
            href={tab.href}
            className={cn(
              'relative flex flex-1 flex-col items-center gap-1 py-2.5 text-micro',
              tab.active ? 'text-ink' : 'text-muted',
            )}
            aria-current={tab.active ? 'page' : undefined}
          >
            <span aria-hidden="true">{tab.icon}</span>
            {tab.label}
            {!!tab.badge && (
              <span className="absolute top-1 right-[calc(50%-18px)] flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-medium text-ink">
                {tab.badge}
              </span>
            )}
          </a>
        ))}
      </nav>
    </div>
  );
}
