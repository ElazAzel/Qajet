import { Easing, interpolate, type SpringConfig, spring } from 'remotion';

/**
 * Движение ролика. Всё считается от номера кадра: CSS transition/animation
 * в рендере не работают.
 *
 * Микроанимации интерфейса (появление блоков, пилюли, CountUp, полосы
 * вариантов) идут на токенах продукта — packages/ui/src/motion/tokens.ts,
 * §12 «Движение». Кинематографичные эффекты ролика (камера, курсор,
 * вспышки клика) — свои кривые ниже.
 */

export const FPS = 30;

// Любой interpolate в проекте получает эти опции: значения не выходят за диапазон.
export const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** Миллисекунды продукта → кадры ролика. */
export const msToFrames = (ms: number): number => (ms / 1000) * FPS;

// Токены продукта (§12).
export const PRODUCT = {
  instant: msToFrames(120),
  quick: msToFrames(180),
  base: msToFrames(240),
  deliberate: msToFrames(420),
  stagger: msToFrames(60),
  standard: Easing.bezier(0.2, 0, 0, 1),
  decelerate: Easing.bezier(0, 0, 0, 1),
  accelerate: Easing.bezier(0.3, 0, 1, 1),
  // Кривая роста полосы варианта (packages/ui/src/motion/bar-grow.tsx).
  bar: Easing.bezier(0.16, 1, 0.3, 1),
} as const;

// Кривые ролика.
export const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
export const EASE_IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);
// «Хлыст» камеры: резкий разгон и долгое торможение.
export const EASE_WHIP = Easing.bezier(0.7, 0, 0.1, 1);

export const SPRING_SMOOTH: Partial<SpringConfig> = { damping: 200 };
export const SPRING_POP: Partial<SpringConfig> = { damping: 11, stiffness: 240, mass: 0.6 };

/** Прогресс пружины 0 → 1, стартующей на кадре `start`. */
export const springAt = (
  frame: number,
  start: number,
  config: Partial<SpringConfig> = SPRING_SMOOTH,
): number => spring({ frame: frame - start, fps: FPS, config });

/** Прогресс 0 → 1 на отрезке [start, start + duration]. */
export const progress = (
  frame: number,
  start: number,
  duration: number,
  easing: (t: number) => number = EASE_OUT,
): number => interpolate(frame, [start, start + duration], [0, 1], { ...CLAMP, easing });

/**
 * Reveal продукта (packages/ui/src/motion/reveal.tsx): opacity 0 → 1
 * и сдвиг на 6px за base (240 мс), кривая decelerate.
 */
export const reveal = (frame: number, start: number): { opacity: number; translate: string } => {
  const p = progress(frame, start, PRODUCT.base, PRODUCT.decelerate);
  return { opacity: p, translate: `0 ${(1 - p) * 6}px` };
};

/** Motion blur по скорости: размытие пропорционально сдвигу за один кадр. */
export const velocityBlur = (
  position: (f: number) => number,
  frame: number,
  factor = 0.06,
  max = 3,
): number => Math.min(Math.abs(position(frame) - position(frame - 1)) * factor, max);

export type Point = { x: number; y: number };
export type PathKeyframe = Point & { frame: number };

/** Позиция на ломаной траектории; между ключами — EASE_IN_OUT. */
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

// Кнопка при клике вжимается до 0.94 и возвращается пружиной.
const PRESS_DOWN_FRAMES = 3;
export const pressScale = (frame: number, clickFrame: number): number => {
  if (frame < clickFrame) return 1;
  if (frame < clickFrame + PRESS_DOWN_FRAMES) {
    return interpolate(frame, [clickFrame, clickFrame + PRESS_DOWN_FRAMES], [1, 0.94], CLAMP);
  }
  return 0.94 + 0.06 * springAt(frame, clickFrame + PRESS_DOWN_FRAMES, SPRING_POP);
};

/** Печать текста: сколько символов видно на кадре. */
export const typedLength = (frame: number, start: number, end: number, length: number): number =>
  Math.floor(interpolate(frame, [start, end], [0, length], CLAMP));

/** Значение шага по кадру: последний шаг, чей кадр уже наступил. */
export const stepAt = <T>(frame: number, steps: readonly { frame: number; value: T }[]): T => {
  let current = steps[0].value;
  for (const s of steps) {
    if (frame >= s.frame) current = s.value;
  }
  return current;
};

/** CountUp продукта: 0 → value за deliberate (420 мс), кривая decelerate. */
export const countUp = (frame: number, start: number, value: number): number =>
  value * progress(frame, start, PRODUCT.deliberate, PRODUCT.decelerate);
