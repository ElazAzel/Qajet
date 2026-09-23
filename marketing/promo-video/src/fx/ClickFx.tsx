import type React from 'react';
import { interpolate } from 'remotion';
import { CLAMP, EASE_OUT } from '../lib/motion';
import { theme } from '../theme';

// Длительность вспышки клика в кадрах.
const DURATION = 20;
// Число лучей «брызг» вокруг точки клика.
const RAYS = 8;

/**
 * Вспышка клика в экранных координатах: кольцо-ripple фирменного
 * фиолетового и короткие лучи. Эффект ролика, не продукта.
 */
export const ClickFx: React.FC<{ x: number; y: number; frame: number; clickFrame: number }> = ({
  x,
  y,
  frame,
  clickFrame,
}) => {
  if (frame < clickFrame || frame > clickFrame + DURATION) return null;
  const t = interpolate(frame, [clickFrame, clickFrame + DURATION], [0, 1], {
    ...CLAMP,
    easing: EASE_OUT,
  });
  const ring = 16 + t * 110;
  return (
    <div style={{ position: 'absolute', left: x, top: y, zIndex: 55 }}>
      <div
        style={{
          position: 'absolute',
          left: -ring / 2,
          top: -ring / 2,
          width: ring,
          height: ring,
          borderRadius: '50%',
          border: `3px solid ${theme.color.purple}`,
          background: 'rgba(108, 93, 211, 0.12)',
          opacity: 1 - t,
          boxSizing: 'border-box',
        }}
      />
      {Array.from({ length: RAYS }, (_, i) => {
        const angle = (i / RAYS) * 360;
        const inner = 14 + t * 34;
        const len = interpolate(t, [0, 0.4, 1], [4, 16, 2], CLAMP);
        return (
          <div
            key={angle}
            style={{
              position: 'absolute',
              left: 0,
              top: -1.5,
              width: len,
              height: 3,
              borderRadius: 2,
              background: i % 2 === 0 ? theme.color.purple : theme.color.lime,
              transformOrigin: '0 50%',
              // Порядок важен: сначала поворот, потом сдвиг вдоль луча.
              transform: `rotate(${angle}deg) translateX(${inner}px)`,
              opacity: interpolate(t, [0, 0.2, 1], [0, 1, 0], CLAMP),
            }}
          />
        );
      })}
    </div>
  );
};
