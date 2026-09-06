'use client';

import { motion, useInView } from 'motion/react';
import { useRef } from 'react';
import { cn } from '../lib/cn';
import { usePrefersReducedMotion } from './provider';
import { seconds, staggerStep, variantBarChoreography } from './tokens';

/**
 * Полоса варианта — фирменный элемент QAJET (agents.md §12).
 *
 * «Каждый из трёх вариантов — горизонтальная составная полоса в единой
 * шкале для всех вариантов, разбитая на: товар / нанесение и работы /
 * доставка / комиссия QAJET / налоговый эффект. Разницу между вариантами
 * видно физически, глазом, без чтения цифр.»
 *
 * Это САМЫЙ смелый и заметный момент движения во всём продукте — и
 * единственное место, где хореография прописана в спеке буквально:
 * полосы вырастают из нуля в 420мс, последовательно, с задержкой 60мс.
 * Значения не трогать без правки agents.md §12.
 *
 * Технически: рост по ширине (scaleX от общего максимума среди вариантов),
 * не по layout — иначе соседние полосы дёргаются при перерасчёте.
 * transform-origin слева, чтобы рост читался как «наливается слева направо»,
 * как в бумажной ведомости.
 */

export interface BarSegment {
  key: string;
  label: string;
  /** Доля от общей ширины шкалы (0..1), уже посчитанная относительно
   *  максимума среди ВСЕХ сравниваемых вариантов — не только своего. */
  fraction: number;
  color: 'ink' | 'muted' | 'accent' | 'signal';
  /** Показывается при раскрытии декомпозиции, не на самой полосе. */
  amountLabel: string;
}

const segmentColor: Record<BarSegment['color'], string> = {
  ink: 'bg-ink',
  muted: 'bg-muted',
  accent: 'bg-accent',
  signal: 'bg-signal',
};

export interface BarGrowProps {
  segments: BarSegment[];
  /** Позиция среди сравниваемых вариантов — считает задержку стаггера. */
  index: number;
  className?: string;
  /** Высота полосы. Одна и та же для всех вариантов на экране. */
  heightClassName?: string;
}

export function BarGrow({ segments, index, className, heightClassName = 'h-8' }: BarGrowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-15% 0px' });
  const reduced = usePrefersReducedMotion();
  const delay = index * staggerStep;

  return (
    <div
      ref={ref}
      className={cn(
        'flex w-full overflow-hidden rounded-[var(--radius-doc)]',
        heightClassName,
        className,
      )}
      role="img"
      aria-label={segments.map((s) => `${s.label}: ${s.amountLabel}`).join(', ')}
    >
      {segments.map((segment, i) => (
        <motion.div
          key={segment.key}
          className={cn(segmentColor[segment.color], 'h-full origin-left')}
          style={{
            width: `${segment.fraction * 100}%`,
            // Тонкий разделитель между сегментами одной полосы — не тень.
            borderLeft: i > 0 ? '1px solid var(--color-paper)' : undefined,
          }}
          initial={reduced ? false : { scaleX: 0 }}
          animate={inView || reduced ? { scaleX: 1 } : false}
          transition={{
            duration: seconds('deliberate'),
            ease: [0.16, 1, 0.3, 1],
            delay: delay + i * 0.015,
          }}
        />
      ))}
    </div>
  );
}

/** Общая длительность сцены сравнения — для e2e и для синхронизации с CountUp. */
export function barSceneDurationMs(variantCount: number): number {
  return (
    variantBarChoreography.durationMs +
    Math.max(0, variantCount - 1) * variantBarChoreography.staggerSeconds * 1000
  );
}
