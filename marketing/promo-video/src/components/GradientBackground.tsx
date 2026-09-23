import type React from 'react';
import { AbsoluteFill, useVideoConfig } from 'remotion';
import { theme } from '../theme';

type Blob = {
  color: string;
  size: number;
  // Базовая позиция центра в долях кадра (0..1).
  x: number;
  y: number;
  // Амплитуда дрейфа в px и скорость (радиан на единицу time).
  ampX: number;
  ampY: number;
  speed: number;
  phase: number;
  opacity: number;
};

// Раскладка blob'ов. Цвета берутся из theme.color.blobs.
const BLOBS: readonly Blob[] = [
  {
    color: theme.color.blobs[0],
    size: 900,
    x: 0.18,
    y: 0.2,
    ampX: 90,
    ampY: 60,
    speed: 0.012,
    phase: 0,
    opacity: 0.22,
  },
  {
    color: theme.color.blobs[1],
    size: 1000,
    x: 0.85,
    y: 0.25,
    ampX: 70,
    ampY: 80,
    speed: 0.01,
    phase: 1.7,
    opacity: 0.3,
  },
  {
    color: theme.color.blobs[2],
    size: 950,
    x: 0.72,
    y: 0.9,
    ampX: 100,
    ampY: 50,
    speed: 0.009,
    phase: 3.1,
    opacity: 0.28,
  },
  {
    color: theme.color.blobs[3],
    size: 800,
    x: 0.12,
    y: 0.95,
    ampX: 60,
    ampY: 70,
    speed: 0.011,
    phase: 4.4,
    opacity: 0.26,
  },
];

type Props = {
  /**
   * «Время» дрейфа. Считает MainSequence: фон один на весь ролик и лежит
   * под всеми сценами, поэтому переходы не режут его швом.
   */
  time: number;
};

/** Светлый фон с медленно дрейфующими размытыми градиентными пятнами. */
export const GradientBackground: React.FC<Props> = ({ time }) => {
  const { width, height } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: theme.color.background, overflow: 'hidden' }}>
      {BLOBS.map((blob) => {
        const cx = blob.x * width + Math.sin(time * blob.speed + blob.phase) * blob.ampX;
        const cy = blob.y * height + Math.cos(time * blob.speed * 0.8 + blob.phase) * blob.ampY;
        return (
          <div
            key={`${blob.color}-${blob.phase}`}
            style={{
              position: 'absolute',
              left: cx - blob.size / 2,
              top: cy - blob.size / 2,
              width: blob.size,
              height: blob.size,
              borderRadius: '50%',
              background: blob.color,
              opacity: blob.opacity,
              filter: 'blur(120px)',
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};
