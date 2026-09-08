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
      const nextIndex =
        currentIndex === -1
          ? 0
          : Math.min(Math.max(currentIndex + (event.key === 'j' ? 1 : -1), 0), rows.length - 1);

      event.preventDefault();
      rows[nextIndex]?.focus();
      rows[nextIndex]?.scrollIntoView({ block: 'nearest' });
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return <div ref={ref}>{children}</div>;
}
