import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../lib/cn';

/**
 * Карточка-поверхность (§12: «карточки» — rounded-card, border-rule,
 * bg-surface) — до этого компонента её вручную повторяли в каждом экране
 * (28 мест на момент аудита). Нестандартный отступ — через `className`
 * (`cn`/tailwind-merge разрешает конфликт с дефолтным `padding`), а не
 * через новый вариант пропа ради одного места.
 */

export type CardPadding = 'sm' | 'md' | 'none';

const paddingClass: Record<CardPadding, string> = {
  sm: 'p-5',
  md: 'p-6',
  none: '',
};

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, padding = 'md', ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-card border border-rule bg-surface', paddingClass[padding], className)}
      {...props}
    />
  ),
);
Card.displayName = 'Card';
