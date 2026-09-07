import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

/**
 * Плитка метрики — до этого компонента 4 экрана (buyer/page, admin/page,
 * admin/learning/page, metrics/page) держали почти идентичную, но каждая
 * чуть иначе свёрстанную копию. Единственное содержательное различие —
 * есть ли иконка слева (buyer) — меняет направление разметки, остальное
 * (highlight/muted тон, необязательная note) — варианты одного компонента.
 */

export type StatTileTone = 'default' | 'highlight' | 'muted';

export interface StatTileProps {
  icon?: ReactNode;
  value: ReactNode;
  title: string;
  note?: string;
  tone?: StatTileTone;
  className?: string;
}

export function StatTile({ icon, value, title, note, tone = 'default', className }: StatTileProps) {
  const surfaceClass =
    tone === 'highlight' ? 'border-purple bg-purple-10' : 'border-rule bg-surface';

  if (icon) {
    return (
      <div
        className={cn('flex items-center gap-4 rounded-card border p-5', surfaceClass, className)}
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-purple-10 text-purple">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-2xl font-extrabold text-ink">{value}</p>
          <p className="text-fine font-medium text-muted">{title}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('rounded-card border p-5', surfaceClass, className)}>
      <p className={cn('text-2xl font-extrabold', tone === 'muted' ? 'text-muted' : 'text-ink')}>
        {value}
      </p>
      <p className="mt-1.5 text-sm font-semibold text-ink">{title}</p>
      {note && <p className="mt-1 text-fine text-muted">{note}</p>}
    </div>
  );
}
