import { cn } from '../lib/cn';

/**
 * Незаполненное значение — приглушённое тире, а не пустая ячейка.
 * Используется для полей КП с needs_clarification и любых незаполненных
 * значений в списках/карточках.
 */
export function Blank({ className }: { className?: string }) {
  return (
    <span className={cn('text-muted', className)}>
      <span aria-hidden="true">—</span>
      <span className="sr-only">данные отсутствуют</span>
    </span>
  );
}
