'use client';

import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { easing, seconds } from './tokens';

/**
 * Штамп состояния заказа — рамка с текстом и датой, лёгкий наклон,
 * как оттиск в документе (§12). Явно НЕ пилюля: острые углы (radius-doc),
 * а не capsule, обводка, а не заливка.
 *
 * Анимация — «удар печатью»: лёгкий наклон и масштаб при первом появлении,
 * один раз, не циклически. На повторных рендерах (смена вкладки, скролл
 * назад) состояние уже impressed — второй раз не бьём печатью зря.
 */

export type StampTone = 'neutral' | 'accent' | 'signal';

const toneClass: Record<StampTone, string> = {
  neutral: 'border-ink text-ink',
  accent: 'border-accent text-ink bg-accent-wash',
  signal: 'border-signal text-signal bg-signal-wash',
};

export interface StampProps {
  children: ReactNode;
  tone?: StampTone;
  className?: string;
}

export function Stamp({ children, tone = 'neutral', className }: StampProps) {
  return (
    <motion.span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[var(--radius-doc)] border px-2.5 py-1',
        'text-fine font-medium tracking-wide',
        toneClass[tone],
        className,
      )}
      style={{ rotate: '-1deg' }}
      initial={{ opacity: 0, scale: 1.15, rotate: '-4deg' }}
      animate={{ opacity: 1, scale: 1, rotate: '-1deg' }}
      transition={{ duration: seconds('quick'), ease: easing.decelerate }}
    >
      {children}
    </motion.span>
  );
}
