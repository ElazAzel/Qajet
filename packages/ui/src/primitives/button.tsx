import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '../lib/cn';

/**
 * Базовая кнопка QAJET. Перекрашена под токены с нуля, не «shadcn Button
 * с новым цветом» — поэтому здесь нет ни одной ссылки на дефолтные классы
 * shadcn. primary использует акцент и поэтому означает «утвердить/выбрать»;
 * других мест для шафрана в интерфейсе нет.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md';

const base =
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] font-medium ' +
  'transition-colors duration-[var(--duration-instant)] disabled:pointer-events-none disabled:opacity-40';

const variantClass: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-ink hover:bg-accent/90',
  secondary: 'border border-rule bg-surface text-ink hover:bg-paper',
  ghost: 'text-ink hover:bg-ink-soft',
  destructive: 'border border-signal text-signal hover:bg-signal-wash',
};

const sizeClass: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-fine',
  md: 'h-10 px-4 text-sm',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'secondary', size = 'md', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(base, variantClass[variant], sizeClass[size], className)}
      {...props}
    />
  ),
);
Button.displayName = 'Button';
