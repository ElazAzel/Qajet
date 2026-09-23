import type React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { LANDING } from '../content';
import { Words } from '../fx/Words';
import { CLAMP, EASE_IN_OUT, progress } from '../lib/motion';
import { theme } from '../theme';

// Ключевые кадры интро (локальные кадры сцены).
export const INTRO_KEYFRAMES = {
  eyebrowIn: 4,
  headlineIn: 12,
  accentIn: 30,
  wordStagger: 4,
  // Заголовок «пролетает» в камеру перед входом окна.
  exitStart: 74,
} as const;

type Props = { durationInFrames: number };

/** Интро на ink: главный заголовок лендинга, вторая строка — лаймом (§12: лайм только на тёмном). */
export const Intro: React.FC<Props> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const K = INTRO_KEYFRAMES;
  const exit = progress(frame, K.exitStart, durationInFrames - K.exitStart, EASE_IN_OUT);

  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: theme.font.family,
        scale: String(interpolate(frame, [0, K.exitStart], [1, 1.04], CLAMP) * (1 + exit * 0.18)),
        opacity: 1 - exit,
        filter: exit > 0 ? `blur(${exit * 8}px)` : undefined,
      }}
    >
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: theme.color.lime,
          marginBottom: 36,
          opacity: progress(frame, K.eyebrowIn, 10),
          translate: `0 ${(1 - progress(frame, K.eyebrowIn, 10)) * 10}px`,
        }}
      >
        {LANDING.eyebrow}
      </div>
      <div
        style={{
          fontSize: 108,
          lineHeight: 1.08,
          fontWeight: 800,
          letterSpacing: '-0.02em',
          textAlign: 'center',
          color: theme.color.white,
        }}
      >
        <Words text={LANDING.headline} frame={frame} start={K.headlineIn} stagger={K.wordStagger} />
        <br />
        <Words
          text={LANDING.headlineAccent}
          frame={frame}
          start={K.accentIn}
          stagger={K.wordStagger}
          style={{ color: theme.color.lime }}
        />
      </div>
    </AbsoluteFill>
  );
};
