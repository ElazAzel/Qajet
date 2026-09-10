'use client';

import { Command } from 'cmdk';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { easing, seconds } from '../motion/tokens';

/**
 * Командная палитра консьержа (⌘K) — часть ощущения «настольного
 * приложения», не декор. Открывает заказы, переключает стадии,
 * выполняет действия без мыши.
 */
export interface CommandPaletteItem {
  key: string;
  label: string;
  hint?: string;
  onSelect: () => void;
  group: string;
}

/**
 * `open`/`onOpenChange` необязательны: без них палитра держит состояние
 * сама (⌘K и глобальный хоткей Tauri), с ними — им может управлять и
 * оболочка, чтобы кнопка поиска в хедере открывала то же самое окно, а не
 * оставалась кнопкой без действия.
 */
export function CommandPalette({
  items,
  open: controlledOpen,
  onOpenChange,
}: {
  items: CommandPaletteItem[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const resolve = (prev: boolean) => (typeof next === 'function' ? next(prev) : next);
      if (onOpenChange) onOpenChange(resolve(controlledOpen ?? uncontrolledOpen));
      else setUncontrolledOpen(resolve);
    },
    [controlledOpen, onOpenChange, uncontrolledOpen],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setOpen]);

  // Одна и та же страница открывается и в браузере, и в оболочке Tauri
  // (apps/desktop) — глобальный хоткей там ловит нативный слой ОС (браузер
  // физически не может зарегистрировать хоткей вне своей вкладки) и
  // пересылает команду через Tauri IPC. `@tauri-apps/api` в браузере без
  // моста `window.__TAURI_INTERNALS__` не грузим вовсе — обычный веб-визит
  // не должен тянуть и не тянет этот код.
  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('global-shortcut:command-palette', () => setOpen(true)).then((fn) => {
        unlisten = fn;
      });
    });
    return () => unlisten?.();
  }, [setOpen]);

  const groups = groupBy(items, (item) => item.group);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 pt-[15vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setOpen(false)}
        >
          <motion.div
            className="shadow-overlay w-full max-w-lg overflow-hidden rounded-card bg-surface"
            initial={{ opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -8 }}
            transition={{ duration: seconds('quick'), ease: easing.decelerate }}
            onClick={(e) => e.stopPropagation()}
          >
            <Command label="Командная палитра">
              <Command.Input
                autoFocus
                placeholder="Заказ, поставщик, действие…"
                className="w-full border-b border-rule px-4 py-3 text-sm outline-none placeholder:text-muted"
              />
              <Command.List className="max-h-80 overflow-y-auto p-2">
                <Command.Empty className="px-3 py-6 text-center text-fine text-muted">
                  Ничего не найдено
                </Command.Empty>
                {Object.entries(groups).map(([group, groupItems]) => (
                  <Command.Group
                    key={group}
                    heading={group}
                    className="px-1 py-1 text-micro text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                  >
                    {groupItems.map((item) => (
                      <Command.Item
                        key={item.key}
                        onSelect={() => {
                          item.onSelect();
                          setOpen(false);
                        }}
                        className="flex cursor-pointer items-center justify-between rounded-control px-2 py-2 text-sm data-[selected=true]:bg-purple-10"
                      >
                        <span>{item.label}</span>
                        {item.hint && (
                          <span className="numeric text-micro text-muted">{item.hint}</span>
                        )}
                      </Command.Item>
                    ))}
                  </Command.Group>
                ))}
              </Command.List>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Группировка команд по заголовку секции — вынесена наружу для юнит-теста. */
export function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of items) {
    const k = key(item);
    const bucket = result[k];
    if (bucket) {
      bucket.push(item);
    } else {
      result[k] = [item];
    }
  }
  return result;
}
