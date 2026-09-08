'use client';

import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { easing, seconds } from './tokens';

/**
 * Пилюля состояния заказа (§12: «состояние заказа — пилюля, а не штамп»).
 * Имя компонента и API сохранены (используется как `<Stamp>` в местах
 * перехода стадии), визуальный язык — capsule на статусных цветах.
 *
 * Анимация — лёгкое масштабирование при первом появлении/смене стадии,
 * один раз, не циклически.
 */

export type StampTone = 'neutral' | 'progress' | 'success' | 'pending' | 'done' | 'signal';

const toneClass: Record<StampTone, string> = {
  neutral: 'bg-status-neutral-bg text-status-neutral-fg',
  progress: 'bg-status-progress-bg text-status-progress-fg',
  success: 'bg-status-success-bg text-status-success-fg',
  pending: 'bg-status-pending-bg text-status-pending-fg',
  done: 'bg-status-done-bg text-status-done-fg',
  signal: 'bg-status-danger-bg text-status-danger-fg',
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
        'inline-flex items-center gap-1.5 rounded-pill px-3 py-1',
        'text-fine font-semibold',
        toneClass[tone],
        className,
      )}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: seconds('quick'), ease: easing.decelerate }}
    >
      {children}
    </motion.span>
  );
}
