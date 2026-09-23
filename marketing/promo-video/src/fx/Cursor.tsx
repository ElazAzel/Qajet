import type React from 'react';
import { theme } from '../theme';

// Размер курсора на кадре 1080p. Курсор живёт в экранных координатах,
// поэтому не растёт вместе с зумом камеры.
const SIZE = 46;

/** Курсор-стрелка. Кончик стрелки ровно в (x, y). */
export const Cursor: React.FC<{
  x: number;
  y: number;
  scale?: number;
  opacity?: number;
  blur?: number;
}> = ({ x, y, scale = 1, opacity = 1, blur = 0 }) => (
  <svg
    aria-hidden="true"
    width={SIZE}
    height={SIZE}
    viewBox="0 0 24 24"
    style={{
      position: 'absolute',
      left: x,
      top: y,
      translate: `-${(3 / 24) * SIZE}px -${(2 / 24) * SIZE}px`,
      scale: String(scale),
      transformOrigin: `${(3 / 24) * 100}% ${(2 / 24) * 100}%`,
      opacity,
      filter: `blur(${blur}px) drop-shadow(0 4px 10px rgba(0, 0, 0, 0.35))`,
      overflow: 'visible',
      zIndex: 60,
    }}
  >
    <path
      d="M3 2 L3 19.5 L7.6 15.4 L10.6 22 L13.6 20.7 L10.7 14.2 L17 14.2 Z"
      fill={theme.color.ink}
      stroke={theme.color.white}
      strokeWidth={1.6}
      strokeLinejoin="round"
    />
  </svg>
);
