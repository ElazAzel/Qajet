'use client';

import { MotionConfig, useReducedMotion as useMotionReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

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

/**
 * Обёртка над хуком Motion. Тот возвращает null, пока значение неизвестно
 * (сервер и первый рендер) — здесь это приводится к false, чтобы вызывающий
 * код не разбирался с третьим состоянием.
 */
export function usePrefersReducedMotion(): boolean {
  return useMotionReducedMotion() ?? false;
}
