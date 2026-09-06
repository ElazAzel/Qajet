'use client';

import { AnimatePresence, motion, type PanInfo } from 'motion/react';
import { useCallback } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';
import { spring } from './tokens';

/**
 * Модальная шторка мобильной оболочки поставщика: закрывается перетаскиванием
 * вниз, как системный sheet. §12: мобильный сценарий поставщика первичен,
 * поэтому это не «модалка, которую тоже можно свайпнуть», а основной способ
 * закрытия на телефоне — крестик остаётся для доступности с клавиатуры.
 *
 * Порог закрытия: смещение больше 120px ИЛИ скорость больше 500px/с —
 * человек не должен утаскивать шторку через весь экран, чтобы она закрылась.
 */

const DRAG_CLOSE_OFFSET = 120;
const DRAG_CLOSE_VELOCITY = 500;

export interface SheetDragProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
}

export function SheetDrag({ open, onClose, children, title }: SheetDragProps) {
  const handleDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      if (info.offset.y > DRAG_CLOSE_OFFSET || info.velocity.y > DRAG_CLOSE_VELOCITY) {
        onClose();
      }
    },
    [onClose],
  );

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-ink/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={cn(
              'fixed inset-x-0 bottom-0 z-50 rounded-t-[var(--radius-overlay)] bg-surface',
              'shadow-overlay flex max-h-[85vh] flex-col',
            )}
            style={{ paddingBottom: 'var(--safe-bottom)' }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={spring.sheet}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={handleDragEnd}
          >
            <div className="flex justify-center pt-2.5 pb-1" aria-hidden="true">
              <div className="h-1 w-9 rounded-full bg-rule" />
            </div>
            {title && (
              <div className="flex items-center justify-between px-4 pb-2">
                <h2 className="text-base font-medium">{title}</h2>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-[var(--radius-control)] p-1.5 text-muted hover:text-ink"
                  aria-label="Закрыть"
                >
                  ✕
                </button>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
