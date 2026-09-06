'use client';

import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { easing, seconds } from './tokens';

/**
 * Переход между маршрутами.
 *
 * React в App Router Next 16 поддерживает `<ViewTransition>` из 'react' без
 * флагов конфигурации — это даёт кросс-фейд на уровне браузера почти
 * бесплатно для целых переходов страниц. RouteTransition — не замена этому,
 * а точечная надстройка там, где нужен направленный сдвиг ВНУТРИ одной
 * оболочки (список → карточка в рельсе консьержа, смена вкладки в таб-баре
 * поставщика), а не через полную перезагрузку страницы.
 */
export function RouteTransition({ children, routeKey }: { children: ReactNode; routeKey: string }) {
  return (
    <motion.div
      key={routeKey}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: seconds('quick'), ease: easing.standard }}
    >
      {children}
    </motion.div>
  );
}
