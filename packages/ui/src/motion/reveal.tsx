'use client';

import { type HTMLMotionProps, motion } from 'motion/react';
import { createContext, type ReactNode, useContext } from 'react';
import { duration, easing, seconds, staggerStep } from './tokens';

/**
 * Reveal и Stagger — появление блоков и строк.
 *
 * Анимируются только opacity и transform (§12). Смещение маленькое: 6px —
 * это «лист лёг на стол», а не «карточка прилетела». Большие сдвиги и
 * масштабирование при появлении читаются как шаблон.
 *
 * Появление никогда не задерживает данные: элемент уже в DOM и доступен
 * скринридеру, анимируется только его визуальное состояние.
 */

const StaggerIndexContext = createContext<number | null>(null);

/** Смещения появления — 6px, «лист лёг на стол». Общие с ScrollReveal. */
export const revealShift = {
  up: { y: 6, x: 0 },
  down: { y: -6, x: 0 },
  left: { x: 6, y: 0 },
  right: { x: -6, y: 0 },
  none: { x: 0, y: 0 },
} as const;

export type RevealFrom = keyof typeof revealShift;

export interface RevealProps extends Omit<HTMLMotionProps<'div'>, 'initial' | 'animate'> {
  children: ReactNode;
  /** Откуда приходит элемент. По умолчанию снизу. */
  from?: RevealFrom;
  /** Порядковый номер в оркестрованной сцене. Внутри <Stagger> считается сам. */
  index?: number;
  /** Дополнительная задержка в секундах поверх стаггера. */
  delay?: number;
}

export function Reveal({ children, from = 'up', index, delay = 0, ...rest }: RevealProps) {
  const inherited = useContext(StaggerIndexContext);
  const position = index ?? inherited ?? 0;
  const offset = revealShift[from];

  return (
    <motion.div
      initial={{ opacity: 0, ...offset }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{
        duration: seconds('base'),
        ease: easing.decelerate,
        delay: delay + position * staggerStep,
      }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

export interface StaggerProps {
  children: ReactNode[];
  /** Номер, с которого начинается отсчёт. Нужен при склейке нескольких групп. */
  startIndex?: number;
  className?: string;
  /** Тег контейнера: список строк ведомости — это ul или tbody, а не div. */
  as?: 'div' | 'ul' | 'ol' | 'tbody';
}

/**
 * Раздаёт детям порядковые номера, чтобы задержки считались один раз
 * и в одном месте. Родитель не анимируется сам — иначе трансформация
 * контейнера ломает position: sticky у заголовков таблиц.
 */
export function Stagger({ children, startIndex = 0, className, as = 'div' }: StaggerProps) {
  const Tag = as;
  return (
    <Tag className={className}>
      {children.map((child, i) => (
        <StaggerIndexContext.Provider
          // Порядок детей в оркестрованной сцене фиксирован разметкой,
          // поэтому индекс здесь — стабильный ключ.
          // biome-ignore lint/suspicious/noArrayIndexKey: позиция и есть идентичность
          key={i}
          value={startIndex + i}
        >
          {child}
        </StaggerIndexContext.Provider>
      ))}
    </Tag>
  );
}

/** Длительность полной сцены — нужна, чтобы e2e не гадал с таймаутами. */
export function sceneDurationMs(itemCount: number): number {
  return duration.base + Math.max(0, itemCount - 1) * staggerStep * 1000;
}
