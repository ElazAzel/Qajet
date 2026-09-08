'use client';

import { MotionConfig, useReducedMotion as useMotionReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { useSyncExternalStore } from 'react';

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

const subscribeHydration = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

// Motion can read matchMedia on the first client render. Keep that render
// identical to SSR, then apply the user's preference immediately after hydration.
export function usePrefersReducedMotion(): boolean {
  const hydrated = useSyncExternalStore(subscribeHydration, clientSnapshot, serverSnapshot);
  const reduced = useMotionReducedMotion();
  return hydrated && (reduced ?? false);
}
