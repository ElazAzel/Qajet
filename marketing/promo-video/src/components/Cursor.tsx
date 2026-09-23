import type React from 'react';
import { theme } from '../theme';

type Props = {
  // Координаты кончика стрелки в px внутри родителя.
  x: number;
  y: number;
  // Масштаб: при клике курсор слегка «нажимается».
  scale?: number;
  opacity?: number;
  // Motion blur по скорости, px. Считает родитель через velocityBlur2D.
  blur?: number;
};

// Размер курсора в px. На 1080p курсор должен читаться, но не спорить с UI.
const CURSOR_SIZE = 44;

/** Курсор-стрелка в стиле macOS. Кончик стрелки находится ровно в (x, y). */
export const Cursor: React.FC<Props> = ({ x, y, scale = 1, opacity = 1, blur = 0 }) => (
  <svg
    aria-hidden="true"
    width={CURSOR_SIZE}
    height={CURSOR_SIZE}
    viewBox="0 0 24 24"
    style={{
      position: 'absolute',
      left: x,
      top: y,
      // Кончик стрелки в точке (3, 2) viewBox — сдвигаем, чтобы он совпал с (x, y).
      translate: `-${(3 / 24) * CURSOR_SIZE}px -${(2 / 24) * CURSOR_SIZE}px`,
      scale: String(scale),
      transformOrigin: `${(3 / 24) * 100}% ${(2 / 24) * 100}%`,
      opacity,
      filter: `blur(${blur}px) drop-shadow(0 4px 8px rgba(16, 16, 40, 0.25))`,
      overflow: 'visible',
      zIndex: 50,
    }}
  >
    <path
      d="M3 2 L3 19.5 L7.6 15.4 L10.6 22 L13.6 20.7 L10.7 14.2 L17 14.2 Z"
      fill={theme.color.accent}
      stroke="#ffffff"
      strokeWidth={1.6}
      strokeLinejoin="round"
    />
  </svg>
);
