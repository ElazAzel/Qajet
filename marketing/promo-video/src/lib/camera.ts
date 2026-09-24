import { interpolate } from 'remotion';
import { CLAMP, EASE_IN_OUT, EASE_OUT, EASE_WHIP, type Point } from './motion';

/**
 * Виртуальная камера над окном браузера.
 *
 * Окно рисуется в своих CSS-пикселях (как настоящий браузер 1440×810),
 * камера задаёт точку фокуса в координатах окна и зум. Точка фокуса
 * всегда оказывается в центре кадра 1920×1080.
 */

export const STAGE = { width: 1920, height: 1080 } as const;

// Окно браузера: полоса с адресом + вьюпорт 1440×810 (16:9).
export const WINDOW = { width: 1440, titlebar: 48, viewportHeight: 810 } as const;
export const WINDOW_HEIGHT = WINDOW.titlebar + WINDOW.viewportHeight;

// Оболочка продукта (§12): сайдбар 240px, хедер 80px.
export const SHELL_LAYOUT = { sidebar: 240, header: 80 } as const;

// Основная область: всё, что правее сайдбара и ниже хедера. Прокручивается.
export const MAIN = {
  x: SHELL_LAYOUT.sidebar,
  y: WINDOW.titlebar + SHELL_LAYOUT.header,
  width: WINDOW.width - SHELL_LAYOUT.sidebar,
  height: WINDOW.viewportHeight - SHELL_LAYOUT.header,
} as const;

/** Точка страницы (координаты основной области) → точка окна с учётом прокрутки. */
export const pageToWindow = (p: Point, scroll: number): Point => ({
  x: MAIN.x + p.x,
  y: MAIN.y + p.y - scroll,
});

export type Ease = 'inOut' | 'out' | 'whip';
const EASING: Record<Ease, (t: number) => number> = {
  inOut: EASE_IN_OUT,
  out: EASE_OUT,
  whip: EASE_WHIP,
};

export type Camera = { x: number; y: number; zoom: number; rotX: number; rotY: number };
export type CameraKey = {
  frame: number;
  x: number;
  y: number;
  zoom: number;
  rotX?: number;
  rotY?: number;
  // Кривая, по которой камера ПРИХОДИТ в этот ключ.
  ease?: Ease;
};

/** Кадр камеры между ключами. Зум интерполируется в логарифме: наезд ощущается равномерным. */
export const cameraAt = (frame: number, keys: readonly CameraKey[]): Camera => {
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (frame <= first.frame) return clampToWindow(toCamera(first));
  if (frame >= last.frame) return clampToWindow(toCamera(last));
  let i = 0;
  while (i < keys.length - 2 && frame >= keys[i + 1].frame) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const t = interpolate(frame, [a.frame, b.frame], [0, 1], {
    ...CLAMP,
    easing: EASING[b.ease ?? 'inOut'],
  });
  const lerp = (u: number, v: number): number => u + (v - u) * t;
  return clampToWindow({
    x: lerp(a.x, b.x),
    y: lerp(a.y, b.y),
    zoom: Math.exp(lerp(Math.log(a.zoom), Math.log(b.zoom))),
    rotX: lerp(a.rotX ?? 0, b.rotX ?? 0),
    rotY: lerp(a.rotY ?? 0, b.rotY ?? 0),
  });
};

/**
 * Камера не заходит за край окна: на крупном плане кадр целиком занят
 * интерфейсом, без полос сцены. Если окно на этом зуме уже кадра —
 * фокус по этой оси встаёт в центр окна.
 */
const clampAxis = (v: number, halfView: number, size: number): number => {
  const min = halfView;
  const max = size - halfView;
  return min > max ? size / 2 : Math.min(Math.max(v, min), max);
};
const clampToWindow = (c: Camera): Camera => ({
  ...c,
  x: clampAxis(c.x, STAGE.width / 2 / c.zoom, WINDOW.width),
  y: clampAxis(c.y, STAGE.height / 2 / c.zoom, WINDOW_HEIGHT),
});

const toCamera = (k: CameraKey): Camera => ({
  x: k.x,
  y: k.y,
  zoom: k.zoom,
  rotX: k.rotX ?? 0,
  rotY: k.rotY ?? 0,
});

/** Точка окна → точка кадра (без учёта наклона: наклон бывает только на входе/выходе). */
export const windowToScreen = (p: Point, cam: Camera): Point => ({
  x: STAGE.width / 2 + (p.x - cam.x) * cam.zoom,
  y: STAGE.height / 2 + (p.y - cam.y) * cam.zoom,
});

/** CSS transform окна: масштаб вокруг фокуса + наклон вокруг центра кадра. */
export const windowTransform = (cam: Camera): string => {
  const cx = STAGE.width / 2;
  const cy = STAGE.height / 2;
  const tx = cx - cam.x * cam.zoom;
  const ty = cy - cam.y * cam.zoom;
  return [
    `translate(${cx}px, ${cy}px)`,
    `rotateX(${cam.rotX}deg)`,
    `rotateY(${cam.rotY}deg)`,
    `translate(${-cx}px, ${-cy}px)`,
    `translate(${tx}px, ${ty}px)`,
    `scale(${cam.zoom})`,
  ].join(' ');
};

// Точки кадра, по сдвигу которых меряется скорость камеры для motion blur.
const PROBES: readonly Point[] = [
  { x: 160, y: 140 },
  { x: 1760, y: 140 },
  { x: 160, y: 940 },
  { x: 1760, y: 940 },
];

/** Motion blur камеры: насколько сдвинулось изображение под углами кадра за один кадр. */
export const cameraBlur = (
  frame: number,
  keys: readonly CameraKey[],
  factor = 0.05,
  max = 4,
): number => {
  const now = cameraAt(frame, keys);
  const prev = cameraAt(frame - 1, keys);
  let speed = 0;
  for (const s of PROBES) {
    // Какая точка окна сейчас под пробой — и где она была кадр назад.
    const w = {
      x: now.x + (s.x - STAGE.width / 2) / now.zoom,
      y: now.y + (s.y - STAGE.height / 2) / now.zoom,
    };
    const before = windowToScreen(w, prev);
    speed = Math.max(speed, Math.hypot(before.x - s.x, before.y - s.y));
  }
  const blur = speed * factor;
  return blur < 0.35 ? 0 : Math.min(blur, max);
};
