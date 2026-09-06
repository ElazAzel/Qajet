import { cn } from '../lib/cn';

/**
 * Прочерк на линии подчёркивания вместо серого плейсхолдера (§12).
 * Используется для полей КП с needs_clarification и любых незаполненных
 * значений в ведомости.
 */
export function Blank({ className, width = 'w-14' }: { className?: string; width?: string }) {
  return (
    <span className={cn('blank-field', width, className)}>
      <span aria-hidden="true">—</span>
      <span className="sr-only">данные отсутствуют</span>
    </span>
  );
}
