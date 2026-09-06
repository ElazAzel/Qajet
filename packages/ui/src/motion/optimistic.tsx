'use client';

import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

/**
 * Состояние действия до подтверждения сервером — например, поставщик
 * жмёт «берусь», UI отзывается мгновенно, а Server Action ещё выполняется.
 *
 * Пульсация opacity, не спиннер поверх контента: человек продолжает видеть
 * то, что он только что подтвердил, а не смотрит на индикатор загрузки.
 * При ошибке вызывающий код обязан откатить состояние и показать причину —
 * этот компонент сам ничего не откатывает, он только сигнализирует «ждём».
 */
export function Optimistic({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <motion.div
      className={cn(pending && 'pointer-events-none')}
      animate={pending ? { opacity: [1, 0.55, 1] } : { opacity: 1 }}
      transition={
        pending
          ? { duration: 1.1, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }
          : { duration: 0.15 }
      }
      aria-busy={pending}
    >
      {children}
    </motion.div>
  );
}
