import { linearTiming, TransitionSeries } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import type React from 'react';
import { AbsoluteFill } from 'remotion';
import { StageBackground } from './fx/StageBackground';
import { EASE_IN_OUT } from './lib/motion';
import { Intro } from './scenes/Intro';
import { Journey } from './scenes/Journey';
import { Outro } from './scenes/Outro';

/**
 * ТАЙМИНГИ СЦЕН (кадры, 30 fps). Меняются только здесь.
 * Ключевые кадры внутри пути покупателя — в src/journey/script.ts.
 *
 * Переход в TransitionSeries проигрывает две сцены одновременно,
 * поэтому каждый переход «съедает» свою длительность из суммы:
 *
 *   total = intro + journey + outro − introToJourney − journeyToOutro
 *         = 100 + 710 + 120 − 12 − 18
 *         = 900 кадров = 30 сек
 *
 * На общей шкале:
 *   0–88      интро
 *   88–100    fade: заголовок уходит, окно влетает
 *   100–792   путь покупателя (заявка → варианты → подтверждение → документы)
 *   792–810   fade в аутро
 *   810–900   аутро, 890–900 — стоп-кадр
 *
 * Если меняете одно число, поправьте другое: проверка ниже упадёт при
 * старте Studio/рендера, если сумма разойдётся с total.
 */
export const TIMING = {
  fps: 30,
  total: 900,
  intro: 100,
  journey: 710,
  outro: 120,
  introToJourney: 12,
  journeyToOutro: 18,
} as const;

const computedTotal =
  TIMING.intro + TIMING.journey + TIMING.outro - TIMING.introToJourney - TIMING.journeyToOutro;

if (computedTotal !== TIMING.total) {
  throw new Error(
    `TIMING: сцены дают ${computedTotal} кадров вместо ${TIMING.total}. Проверьте формулу в MainSequence.tsx.`,
  );
}

export const MainSequence: React.FC = () => (
  <AbsoluteFill>
    {/* Один статичный фон на весь ролик: сцены прозрачные, переходы не режут его швом */}
    <StageBackground />
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={TIMING.intro} name="Интро">
        <Intro durationInFrames={TIMING.intro} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade({ shouldFadeOutExitingScene: true })}
        timing={linearTiming({ durationInFrames: TIMING.introToJourney, easing: EASE_IN_OUT })}
      />
      <TransitionSeries.Sequence durationInFrames={TIMING.journey} name="Путь покупателя">
        <Journey />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade({ shouldFadeOutExitingScene: true })}
        timing={linearTiming({ durationInFrames: TIMING.journeyToOutro, easing: EASE_IN_OUT })}
      />
      <TransitionSeries.Sequence durationInFrames={TIMING.outro} name="Аутро">
        <Outro durationInFrames={TIMING.outro} />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  </AbsoluteFill>
);
