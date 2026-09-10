import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '../lib/cn';

/**
 * Базовая кнопка QAJET (§12): primary — фиолетовый, означает основное
 * действие/CTA; dark — тёмная кнопка на светлом фоне (второй по значимости
 * акцент, используется как «Новый проект» рядом с primary); lime — только
 * на тёмных поверхностях (hero-баннер, промо-карточка сайдбара).
 */

export type ButtonVariant = 'primary' | 'dark' | 'lime' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md';

const base =
  'inline-flex items-center justify-center gap-2 rounded-control font-semibold ' +
  'transition-colors duration-[var(--duration-instant)] disabled:pointer-events-none disabled:opacity-40';

const variantClass: Record<ButtonVariant, string> = {
  primary: 'bg-purple text-white hover:bg-purple/90',
  dark: 'bg-ink text-white hover:bg-ink/90',
  lime: 'bg-lime text-ink hover:bg-lime/90',
  secondary: 'border border-rule bg-surface text-ink hover:bg-page',
  ghost: 'text-ink hover:bg-page',
  destructive: 'border border-signal text-signal hover:bg-status-danger-bg',
};

const sizeClass: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-fine',
  md: 'h-10 px-4 text-sm',
};

/**
 * Те же классы для ссылки, которая по смыслу кнопка (CTA ведёт на другой
 * маршрут). `<Button>` рендерит `<button>` и навигацией не занимается, а
 * оборачивать ссылку в кнопку — ломать семантику и Cmd+клик. До этого
 * такие ссылки повторяли строку классов руками (`app/page.tsx`,
 * `app/not-found.tsx`), и каждая копия расходилась со временем.
 */
export function buttonClass(
  variant: ButtonVariant = 'secondary',
  size: ButtonSize = 'md',
  className?: string,
): string {
  return cn(base, variantClass[variant], sizeClass[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Идёт запрос — крутилка вместо иконки слева, кнопка недоступна. Единственный
   *  разрешённый бесконечный цикл анимации (§12: «только у индикаторов загрузки»). */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'secondary',
      size = 'md',
      type = 'button',
      loading = false,
      disabled,
      children,
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(base, variantClass[variant], sizeClass[size], className)}
      {...props}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';
