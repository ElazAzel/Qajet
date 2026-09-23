import type React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { CLAMP, PRODUCT, progress } from '../lib/motion';
import { type StatusTone, textStyle, theme } from '../theme';

/**
 * Реплики примитивов продукта (packages/ui/src/primitives, motion/stamp.tsx).
 * Размеры и цвета — те же, что в Tailwind-классах продукта.
 */

export type ButtonVariant = 'primary' | 'dark' | 'lime' | 'secondary';
export type ButtonSize = 'sm' | 'md';

const VARIANT: Record<ButtonVariant, React.CSSProperties> = {
  primary: { background: theme.color.purple, color: theme.color.white },
  dark: { background: theme.color.ink, color: theme.color.white },
  lime: { background: theme.color.lime, color: theme.color.ink },
  secondary: {
    background: theme.color.surface,
    color: theme.color.ink,
    boxShadow: `inset 0 0 0 1px ${theme.color.rule}`,
  },
};

// sm: h-8 px-3 text-fine · md: h-10 px-4 text-sm
const SIZE: Record<ButtonSize, React.CSSProperties> = {
  sm: { height: 32, padding: '0 12px', ...textStyle('fine') },
  md: { height: 40, padding: '0 16px', ...textStyle('sm') },
};

/** Крутилка кнопки: единственный разрешённый бесконечный цикл (§12). */
export const Spinner: React.FC<{ size?: number }> = ({ size = 14 }) => {
  const frame = useCurrentFrame();
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: '2px solid currentColor',
        borderTopColor: 'transparent',
        rotate: `${frame * 24}deg`,
        flexShrink: 0,
        boxSizing: 'border-box',
      }}
    />
  );
};

export const Button: React.FC<{
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  width?: number | string;
  loading?: boolean;
  // Масштаб нажатия (pressScale из lib/motion).
  scale?: number;
  icon?: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ label, variant = 'secondary', size = 'md', width, loading, scale = 1, icon, style }) => (
  <div
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderRadius: theme.radius.control,
      fontWeight: 600,
      whiteSpace: 'nowrap',
      boxSizing: 'border-box',
      width,
      scale: String(scale),
      ...VARIANT[variant],
      ...SIZE[size],
      ...style,
    }}
  >
    {loading ? <Spinner /> : icon}
    {label}
  </div>
);

/** Карточка-поверхность: rounded-card, border-rule, bg-surface. */
export const Card: React.FC<{
  padding?: number;
  radius?: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ padding = 20, radius = theme.radius.card, style, children }) => (
  <div
    style={{
      boxSizing: 'border-box',
      borderRadius: radius,
      background: theme.color.surface,
      boxShadow: `inset 0 0 0 1px ${theme.color.rule}`,
      padding,
      ...style,
    }}
  >
    {children}
  </div>
);

/**
 * Пилюля состояния (Stamp). При смене стадии — лёгкое масштабирование
 * 0.85 → 1 за quick (180 мс), как в продукте. `changedAt` — кадр смены.
 */
export const Pill: React.FC<{
  tone: StatusTone;
  label: string;
  changedAt?: number;
  style?: React.CSSProperties;
}> = ({ tone, label, changedAt = -100, style }) => {
  const frame = useCurrentFrame();
  const p = progress(frame, changedAt, PRODUCT.quick, PRODUCT.decelerate);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 12px',
        borderRadius: theme.radius.pill,
        background: theme.status[tone].bg,
        color: theme.status[tone].fg,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        ...textStyle('fine'),
        opacity: interpolate(p, [0, 1], [0, 1], CLAMP),
        scale: String(interpolate(p, [0, 1], [0.85, 1], CLAMP)),
        transformOrigin: 'left center',
        ...style,
      }}
    >
      {label}
    </span>
  );
};

/** Подпись поля: text-fine font-semibold, обязательные — со звёздочкой. */
export const FieldLabel: React.FC<{ label: string; required?: boolean }> = ({
  label,
  required,
}) => (
  <div style={{ ...textStyle('fine'), fontWeight: 600, marginBottom: 8, color: theme.color.ink }}>
    {label}
    {required ? <span style={{ color: theme.color.muted }}> *</span> : null}
  </div>
);

/**
 * Поле ввода продукта: bg-page, rounded-control, px-4 py-3, text-sm.
 * В фокусе — фиолетовая граница и кольцо фокуса (§12, видимый фокус).
 * `flash` 0..1 — подсветка автозаполнения (эффект ролика).
 */
export const InputBox: React.FC<{
  value?: string;
  placeholder?: string;
  focused?: boolean;
  caret?: boolean;
  flash?: number;
  height?: number;
  multiline?: boolean;
  surface?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}> = ({
  value,
  placeholder,
  focused,
  caret,
  flash = 0,
  height = 46,
  multiline,
  surface,
  children,
  style,
}) => (
  <div
    style={{
      position: 'relative',
      boxSizing: 'border-box',
      height,
      borderRadius: theme.radius.control,
      background: flash > 0 ? mix(flash) : surface ? theme.color.surface : theme.color.page,
      boxShadow: focused
        ? `inset 0 0 0 1px ${theme.color.purple}, 0 0 0 2px ${theme.color.surface}, 0 0 0 4px ${theme.color.purple}`
        : flash > 0
          ? `inset 0 0 0 1px rgba(108, 93, 211, ${0.5 * flash})`
          : 'none',
      padding: '12px 16px',
      display: 'flex',
      alignItems: multiline ? 'flex-start' : 'center',
      overflow: 'hidden',
      whiteSpace: 'pre',
      color: theme.color.ink,
      ...textStyle('sm'),
      ...style,
    }}
  >
    {children ??
      (value ? (
        <span>{value}</span>
      ) : (
        <span style={{ color: theme.color.muted }}>{placeholder}</span>
      ))}
    {caret ? <Caret /> : null}
  </div>
);

// Подсветка автозаполнения: от purple-10 обратно к фону поля.
const mix = (flash: number): string =>
  `color-mix(in srgb, ${theme.color.purple10} ${Math.round(flash * 100)}%, ${theme.color.page})`;

/** Каретка ввода: мигает с периодом 16 кадров. */
export const Caret: React.FC<{ solid?: boolean }> = ({ solid }) => {
  const frame = useCurrentFrame();
  const on = solid || Math.floor(frame / 8) % 2 === 0;
  return (
    <span
      style={{
        display: 'inline-block',
        width: 1.5,
        height: 18,
        marginLeft: 1,
        background: theme.color.ink,
        opacity: on ? 1 : 0,
        alignSelf: 'center',
      }}
    />
  );
};

/** Строка «подпись — значение» с верхней линией (dl в карточках продукта). */
export const DefRow: React.FC<{
  term: string;
  value: React.ReactNode;
  strong?: boolean;
  first?: boolean;
  style?: React.CSSProperties;
}> = ({ term, value, strong = true, first, style }) => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'space-between',
      gap: 16,
      borderTop: first ? 'none' : `1px solid ${theme.color.rule}`,
      paddingTop: first ? 0 : 8,
      ...textStyle('fine'),
      ...style,
    }}
  >
    <span style={{ color: theme.color.muted }}>{term}</span>
    <span
      style={{
        color: theme.color.ink,
        fontWeight: strong ? 600 : 400,
        fontVariantNumeric: 'tabular-nums',
        textAlign: 'right',
      }}
    >
      {value}
    </span>
  </div>
);
