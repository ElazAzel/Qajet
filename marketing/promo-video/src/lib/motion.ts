import { Easing, interpolate, type SpringConfig, spring } from 'remotion';

/**
 * Общие хелперы анимации. Всё считается только от номера кадра,
 * поэтому рендер детерминирован: CSS transition/animation не используются.
 */

// Любой interpolate в проекте получает эти опции: значения не выходят за диапазон.
export const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// Основная кривая движения: быстрый старт, долгое мягкое торможение.
export const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
// Для перемещения курсора: плавный разгон и плавная остановка.
export const EASE_IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);

// Пружина без отскока: спокойное «дорогое» появление.
export const SPRING_SMOOTH: Partial<SpringConfig> = { damping: 200 };
// Пружина с лёгким отскоком: возврат кнопки после нажатия.
export const SPRING_BOUNCE: Partial<SpringConfig> = { damping: 12, stiffness: 220, mass: 0.6 };

/** Прогресс пружины 0 → 1, стартующей на кадре `start`. */
export const springAt = (
  frame: number,
  fps: number,
  start: number,
  config: Partial<SpringConfig> = SPRING_SMOOTH,
): number => spring({ frame: frame - start, fps, config });

/**
 * Motion blur по скорости: размытие пропорционально сдвигу за один кадр.
 * `position` — функция «кадр → координата в px», её зовём для frame и frame - 1.
 */
export const velocityBlur = (
  position: (f: number) => number,
  frame: number,
  factor = 0.06,
  max = 3,
): number => Math.min(Math.abs(position(frame) - position(frame - 1)) * factor, max);

/** То же для движения в 2D (курсор): берём длину вектора смещения. */
export const velocityBlur2D = (
  position: (f: number) => { x: number; y: number },
  frame: number,
  factor = 0.05,
  max = 2.5,
): number => {
  const a = position(frame);
  const b = position(frame - 1);
  return Math.min(Math.hypot(a.x - b.x, a.y - b.y) * factor, max);
};

// Кадры, за которые кнопка «вжимается» после клика.
const PRESS_DOWN_FRAMES = 3;
// Глубина нажатия кнопки: из ТЗ, scale 0.94.
export const PRESSED_SCALE = 0.94;

/**
 * Масштаб кнопки вокруг клика: 1 → 0.94 за PRESS_DOWN_FRAMES кадров,
 * затем пружиной обратно к 1.
 */
export const pressScale = (frame: number, fps: number, clickFrame: number): number => {
  if (frame < clickFrame + PRESS_DOWN_FRAMES) {
    return interpolate(frame, [clickFrame, clickFrame + PRESS_DOWN_FRAMES], [1, PRESSED_SCALE], {
      ...CLAMP,
      easing: EASE_OUT,
    });
  }
  const back = springAt(frame, fps, clickFrame + PRESS_DOWN_FRAMES, SPRING_BOUNCE);
  return PRESSED_SCALE + (1 - PRESSED_SCALE) * back;
};

export type Point = { x: number; y: number };
export type PathKeyframe = Point & { frame: number };

/**
 * Позиция на ломаной траектории из ключевых кадров.
 * Каждый сегмент идёт со своим easing (по умолчанию EASE_IN_OUT).
 */
export const pointOnPath = (frame: number, path: readonly PathKeyframe[]): Point => {
  const frames = path.map((k) => k.frame);
  const easing = path.slice(1).map(() => EASE_IN_OUT);
  return {
    x: interpolate(
      frame,
      frames,
      path.map((k) => k.x),
      { ...CLAMP, easing },
    ),
    y: interpolate(
      frame,
      frames,
      path.map((k) => k.y),
      { ...CLAMP, easing },
    ),
  };
};
