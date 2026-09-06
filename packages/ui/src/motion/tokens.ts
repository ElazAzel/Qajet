/**
 * Токены движения QAJET. Источник истины — agents.md §12 «Движение».
 *
 * Те же значения продублированы CSS-переменными в apps/web/app/globals.css,
 * чтобы CSS-переходы и JS-анимации шли в одном темпе. При изменении править
 * оба места — расхождение видно глазом сразу.
 *
 * Правило, которое делает движение системой, а не набором эффектов:
 * НОВЫХ длительностей и кривых не заводить. Нужна другая скорость —
 * значит, выбрана не та роль.
 */

/** Длительности в миллисекундах. */
export const duration = {
  /** Отклик на нажатие, смена состояния кнопки. Человек не должен это замечать. */
  instant: 120,
  /** Раскрытие строки, подсказка, смена вкладки. */
  quick: 180,
  /** Появление панели, переход маршрута, вход списка. */
  base: 240,
  /** Только сигнатурная сцена: рост полос варианта. Больше нигде. */
  deliberate: 420,
} as const;

export type DurationToken = keyof typeof duration;

/**
 * Кривые. Названы по физике, а не по номеру:
 * decelerate — объект прилетает и тормозит (появление),
 * accelerate — объект разгоняется и улетает (уход),
 * standard   — перемещение внутри экрана.
 */
export const easing = {
  standard: [0.2, 0, 0, 1],
  decelerate: [0, 0, 0, 1],
  accelerate: [0.3, 0, 1, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

export type EasingToken = keyof typeof easing;

/** Пружины для жестов: перетаскивание шторки, изменение размера панели. */
export const spring = {
  /** Возврат шторки на место после отпускания. */
  sheet: { type: 'spring', stiffness: 420, damping: 38, mass: 0.9 },
  /** Перестановка строк в списке консьержа. */
  reorder: { type: 'spring', stiffness: 560, damping: 44, mass: 0.7 },
} as const;

/** Шаг задержки между соседними элементами в оркестрованной сцене. */
export const staggerStep = 0.06;

/**
 * Сигнатурная хореография §12, вынесенная отдельной константой,
 * чтобы её нельзя было «немного подправить» в компоненте.
 */
export const variantBarChoreography = {
  durationMs: duration.deliberate,
  staggerSeconds: staggerStep,
} as const;

/** Секунды — Motion принимает длительности в секундах, а не в миллисекундах. */
export const seconds = (token: DurationToken): number => duration[token] / 1000;
