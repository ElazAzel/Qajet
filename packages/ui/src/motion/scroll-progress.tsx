'use client';

import { motion, useScroll, useSpring } from 'motion/react';
import { usePrefersReducedMotion } from './provider';

/**
 * Тонкая полоса прогресса чтения — обычно под шапкой длинной страницы.
 * Пружина сглаживает рывки колёсика мыши/инерцию тачпада; под reduced
 * motion — жёсткая привязка к прогрессу без пружины, а не отключение
 * совсем: это не декоративная анимация, а прямая проекция прокрутки,
 * которую совершает сам пользователь.
 */
export function ScrollProgress({ className }: { className?: string }) {
  const { scrollYProgress } = useScroll();
  const reduced = usePrefersReducedMotion();
  const smooth = useSpring(scrollYProgress, { stiffness: 420, damping: 38, mass: 0.9 });
  return (
    <motion.div
      className={className}
      style={{ scaleX: reduced ? scrollYProgress : smooth }}
      aria-hidden="true"
    />
  );
}
