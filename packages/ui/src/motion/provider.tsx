'use client';

import { MotionConfig, useReducedMotion as useMotionReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

/**
 * Единая точка, где движение выключается целиком.
 *
 * §12 требует уважать prefers-reduced-motion. Проверять его в каждом
 * компоненте по отдельности — гарантированный способ забыть про половину
 * из них, поэтому решение принимается здесь один раз.
 *
 * reducedMotion="user" гасит анимации transform и layout внутри самого
 * Motion. Там, где мы считаем задержки стаггера вручную, примитивы
 * дополнительно спрашивают usePrefersReducedMotion().
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

// Motion can read matchMedia on the first client render. Keep that render
// identical to SSR (useEffect только после маунта — гарантированно один раз,
// в отличие от useSyncExternalStore с no-op subscribe, который не обязан
// перерендерить компонент только потому, что гидратация завершилась), затем
// применить предпочтение пользователя сразу после гидратации.
export function usePrefersReducedMotion(): boolean {
  const [hydrated, setHydrated] = useState(false);
  const reduced = useMotionReducedMotion();

  useEffect(() => {
    setHydrated(true);
  }, []);

  return hydrated && (reduced ?? false);
}
