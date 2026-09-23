import { linearTiming, TransitionSeries } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import type React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { GradientBackground } from './components/GradientBackground';
import { EASE_IN_OUT } from './lib/motion';
import { Intro } from './scenes/Intro';
import { OUTRO_HOLD_FRAMES, Outro } from './scenes/Outro';
import { ProductDemo } from './scenes/ProductDemo';

/**
 * ТАЙМИНГИ СЦЕН (кадры, 30 fps). Меняются только здесь.
 *
 * Переход в TransitionSeries проигрывает две сцены одновременно,
 * поэтому каждый переход «съедает» свою длительность из суммы:
 *
 *   total = intro + demo + outro − introToDemo − demoToOutro
 *         = 85 + 300 + 105 − 20 − 20
 *         = 450 кадров = 15 сек
 *
 * Где что на общей шкале:
 *   0–65     интро одно
 *   65–85    slide снизу: интро уходит вверх, демо въезжает (середина = 75 = 2.5 сек)
 *   85–345   демо одно
 *   345–365  fade: демо растворяется, аутро проявляется (середина = 355 ≈ 11.8 сек)
 *   365–450  аутро одно, 440–450 — стоп-кадр (OUTRO_HOLD_FRAMES)
 *
 * Если меняете одно число, поправьте другое так, чтобы total остался 450:
 * проверка ниже упадёт при старте Studio/рендера, если сумма разойдётся.
 */
export const TIMING = {
  fps: 30,
  total: 450,
  intro: 85,
  demo: 300,
  outro: 105,
  introToDemo: 20,
  demoToOutro: 20,
} as const;

const computedTotal =
  TIMING.intro + TIMING.demo + TIMING.outro - TIMING.introToDemo - TIMING.demoToOutro;

if (computedTotal !== TIMING.total) {
  throw new Error(
    `TIMING: сцены дают ${computedTotal} кадров вместо ${TIMING.total}. Проверьте формулу в MainSequence.tsx.`,
  );
}

// С этого кадра общей шкалы ролик стоит на месте (включая фон).
const FREEZE_FROM = TIMING.total - OUTRO_HOLD_FRAMES;
// Насколько далеко уплывают blob'ы к середине ролика (в единицах time фона).
const BACKGROUND_DRIFT = 160;

/**
 * Время дрейфа фона. Плавно уходит от 0 к BACKGROUND_DRIFT и возвращается к 0
 * ровно на FREEZE_FROM, со скоростью 0 на обоих концах. Поэтому последний кадр
 * совпадает с первым по фону, и луп в соцсетях идёт без скачка.
 */
const backgroundTime = (frame: number): number => {
  const f = Math.min(frame, FREEZE_FROM);
  return (BACKGROUND_DRIFT * (1 - Math.cos((2 * Math.PI * f) / FREEZE_FROM))) / 2;
};

export const MainSequence: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill>
      {/* Один фон на весь ролик: сцены прозрачные, переходы двигают только контент */}
      <GradientBackground time={backgroundTime(frame)} />
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={TIMING.intro} name="Интро">
          <Intro durationInFrames={TIMING.intro} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={slide({ direction: 'from-bottom' })}
          timing={linearTiming({ durationInFrames: TIMING.introToDemo, easing: EASE_IN_OUT })}
        />
        <TransitionSeries.Sequence durationInFrames={TIMING.demo} name="Демо интерфейса">
          <ProductDemo durationInFrames={TIMING.demo} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          // Сцены прозрачные, поэтому уходящую тоже гасим: иначе аутро наложится на окно браузера.
          presentation={fade({ shouldFadeOutExitingScene: true })}
          timing={linearTiming({ durationInFrames: TIMING.demoToOutro, easing: EASE_IN_OUT })}
        />
        <TransitionSeries.Sequence durationInFrames={TIMING.outro} name="Аутро">
          <Outro durationInFrames={TIMING.outro} />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
