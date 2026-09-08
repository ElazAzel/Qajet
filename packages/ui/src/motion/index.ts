/**
 * Единственная точка входа в моушн-систему QAJET.
 * Примитивы отсюда, никаких прямых импортов motion/react в apps/web —
 * это и есть граница, которая держит движение системой, а не набором эффектов.
 */

export type { BarGrowProps, BarSegment } from './bar-grow';
export { BarGrow, barSceneDurationMs } from './bar-grow';
export type { CountUpProps } from './count-up';
export { CountUp } from './count-up';
export { Optimistic } from './optimistic';
export type { PanelSlideFrom, PanelSlideProps } from './panel-slide';
export { PanelSlide } from './panel-slide';
export { MotionProvider, usePrefersReducedMotion } from './provider';
export type { RevealFrom, RevealProps, StaggerProps } from './reveal';
export { Reveal, revealShift, Stagger, sceneDurationMs } from './reveal';
export { RouteTransition } from './route-transition';
export { ScrollProgress } from './scroll-progress';
export type { ScrollRevealFrom, ScrollRevealProps } from './scroll-reveal';
export { ScrollReveal } from './scroll-reveal';
export type { SheetDragProps } from './sheet-drag';
export { SheetDrag } from './sheet-drag';
export type { StampProps, StampTone } from './stamp';
export { Stamp } from './stamp';
export type { DurationToken, EasingToken } from './tokens';
export { duration, easing, seconds, spring, staggerStep, variantBarChoreography } from './tokens';
