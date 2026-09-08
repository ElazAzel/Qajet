'use client';

import { type ReactNode, useEffect, useRef } from 'react';

/**
 * `j`/`k` по списку — план §"Оболочка ПК": «клавиатурная навигация (j/k
 * по списку, g o к заказам, ⌘Enter подтвердить)». Список уже состоит из
 * настоящих `<a>` (доска консьержа — обычные `<Link>`), поэтому Tab/Enter
 * работают из коробки без этого компонента — j/k просто двигают фокус
 * между теми же ссылками на один шаг быстрее, чем Tab, а активация
 * (переход) остаётся нативным поведением фокусированной ссылки.
 */
/**
 * Индекс строки после нажатия `j`/`k`, зажатый в границы списка.
 * Вынесено из обработчика keydown как чистая функция — она же покрыта
 * юнит-тестом (keyboard-list-nav.test.ts), а обработчик остаётся тонкой
 * DOM-обвязкой вокруг неё.
 */
export function nextRowIndex(currentIndex: number, key: 'j' | 'k', rowCount: number): number {
  if (rowCount === 0) return -1;
  if (currentIndex === -1) return 0;
  const direction = key === 'j' ? 1 : -1;
  return Math.min(Math.max(currentIndex + direction, 0), rowCount - 1);
}

export function KeyboardListNav({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'j' && event.key !== 'k') return;
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      const rows = Array.from(
        ref.current?.querySelectorAll<HTMLAnchorElement>('a[data-kbd-row]') ?? [],
      );
      if (rows.length === 0) return;

      const currentIndex = rows.indexOf(document.activeElement as HTMLAnchorElement);
      const nextIndex = nextRowIndex(currentIndex, event.key as 'j' | 'k', rows.length);

      event.preventDefault();
      rows[nextIndex]?.focus();
      rows[nextIndex]?.scrollIntoView({ block: 'nearest' });
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return <div ref={ref}>{children}</div>;
}
