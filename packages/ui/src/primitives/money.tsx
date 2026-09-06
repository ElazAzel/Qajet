import { cn } from '../lib/cn';

/**
 * Форматирование денег для отображения. Хранение и вычисления остаются
 * в packages/engine/money (bigint, тиыны) — этот компонент только рисует.
 */
export function formatKzt(amountKzt: number): string {
  return new Intl.NumberFormat('ru-KZ', {
    style: 'currency',
    currency: 'KZT',
    maximumFractionDigits: 0,
  }).format(amountKzt);
}

export function Money({ amountKzt, className }: { amountKzt: number; className?: string }) {
  return <span className={cn('numeric', className)}>{formatKzt(amountKzt)}</span>;
}
