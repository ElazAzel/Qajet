'use client';

import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { easing, seconds } from './tokens';

/**
 * Панели рабочего стола консьержа: карточка заказа, панель подбора,
 * рабочее пространство сведения КП. Въезжают сбоку, а не проявляются
 * на месте — консьерж должен физически чувствовать «я углубился внутрь».
 *
 * Только transform (x) и opacity. Ширина панели не анимируется —
 * это ломает react-resizable-panels, который сам владеет layout.
 */

export type PanelSlideFrom = 'right' | 'left';

export interface PanelSlideProps {
  children: ReactNode;
  /** Ключ панели: смена ключа = смена контента = новая анимация входа. */
  panelKey: string;
  from?: PanelSlideFrom;
  className?: string;
}

export function PanelSlide({ children, panelKey, from = 'right', className }: PanelSlideProps) {
  const offset = from === 'right' ? 24 : -24;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={panelKey}
        className={cn('h-full min-h-0', className)}
        initial={{ opacity: 0, x: offset }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -offset * 0.4 }}
        transition={{ duration: seconds('base'), ease: easing.standard }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
