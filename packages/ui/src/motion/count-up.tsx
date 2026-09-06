'use client';

import { animate, useInView } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { usePrefersReducedMotion } from './provider';
import { easing, seconds } from './tokens';

/**
 * Денежные значения и количества, доезжающие до своего значения.
 *
 * Два правила, без которых это стало бы шумом:
 *
 * 1. Ширина не должна прыгать. Цифры табличные (font-variant-numeric: tabular-nums
 *    в утилите .numeric), поэтому строка не дёргается на каждом кадре.
 * 2. Итоговое значение сразу лежит в DOM для скринридера. Анимируется только
 *    видимый текст, aria-label содержит финальное значение с первого кадра.
 */

export interface CountUpProps {
  value: number;
  /** Форматирование итогового и промежуточных значений. */
  format: (value: number) => string;
  /** Доступная подпись: «Итого 1 240 000 тенге». */
  label?: string;
  className?: string;
  /** Задержка в секундах — для встраивания в оркестрованную сцену. */
  delay?: number;
}

export function CountUp({ value, format, label, className, delay = 0 }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-10% 0px' });
  const reduced = usePrefersReducedMotion();
  const [display, setDisplay] = useState(() => (reduced ? value : 0));

  useEffect(() => {
    if (reduced) {
      setDisplay(value);
      return;
    }
    if (!inView) return;

    const controls = animate(0, value, {
      duration: seconds('deliberate'),
      ease: easing.decelerate,
      delay,
      onUpdate: setDisplay,
    });
    return () => controls.stop();
  }, [inView, value, delay, reduced]);

  return (
    <span ref={ref} className={cn('numeric', className)}>
      {/* Промежуточные значения анимации из вывода скринридера скрыты:
          зачитывается сразу итоговое, видимо — то, что бежит на экране. */}
      <span aria-hidden="true">{format(display)}</span>
      <span className="sr-only">{label ?? format(value)}</span>
    </span>
  );
}
