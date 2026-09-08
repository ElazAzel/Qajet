'use client';

import { motion, useInView } from 'motion/react';
import { type ReactNode, useRef } from 'react';
import { usePrefersReducedMotion } from './provider';
import { revealShift } from './reveal';
import { easing, seconds } from './tokens';

/**
 * Reveal, но привязанный к попаданию в вьюпорт при прокрутке — не к
 * монтированию. Reveal рассчитан на экраны приложения, где блок и так
 * появляется в кадре целиком (доска, список после загрузки данных);
 * на длинной публичной странице (например, /startupbattle) секции ниже
 * первого экрана этим способом анимировались бы все разом при заходе —
 * бессмысленно. Те же токены (длительность, кривая, смещение 6px из
 * Reveal) — другой триггер, не отдельный язык движения.
 */

export type ScrollRevealFrom = keyof typeof revealShift;

export interface ScrollRevealProps {
  children: ReactNode;
  /** Откуда приходит элемент. По умолчанию снизу. */
  from?: ScrollRevealFrom;
  /** Дополнительная задержка в секундах — для ручного стаггера соседей. */
  delay?: number;
  className?: string;
}

export function ScrollReveal({ children, from = 'up', delay = 0, className }: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  // margin отрицательный снизу — анимация стартует чуть раньше, чем блок
  // целиком видим, не когда уже упёрся в нижний край экрана.
  const inView = useInView(ref, { once: true, margin: '0px 0px -12% 0px' });
  const reduced = usePrefersReducedMotion();
  const offset = revealShift[from];
  const revealed = inView || reduced;

  return (
    <motion.div
      ref={ref}
      className={className}
      // initial/animate — всегда объект, не false: переключение false↔объект
      // между рендерами (когда reduced становится true уже после маунта)
      // у Motion не доигрывает переход — конечное состояние виснет
      // невидимым навсегда. Тот же приём, что у Reveal: стабильная форма
      // пропа, MotionConfig reducedMotion="user" сам гасит переход мгновенно.
      initial={{ opacity: 0, ...offset }}
      animate={revealed ? { opacity: 1, x: 0, y: 0 } : { opacity: 0, ...offset }}
      transition={{ duration: seconds('base'), ease: easing.decelerate, delay }}
    >
      {children}
    </motion.div>
  );
}
