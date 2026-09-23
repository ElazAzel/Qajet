import type React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { AnimatedText } from '../components/AnimatedText';
import { Logo } from '../components/Logo';
import { INTRO } from '../content';
import { CLAMP, springAt } from '../lib/motion';
import { theme } from '../theme';

// Ключевые кадры интро (локальные кадры сцены, 30 fps).
export const INTRO_KEYFRAMES = {
  // Логотип начинает появляться.
  logoIn: 4,
  // Первое слово строки «Скажите, что нужно купить.»
  headlineIn: 16,
  // Первое слово акцентной строки «Остальное сделаем мы.»
  headlineAccentIn: 32,
  // Задержка между словами.
  wordStagger: 4,
} as const;

// Зум камеры внутри сцены: из ТЗ, 1 → 1.04.
const CAMERA_ZOOM_TO = 1.04;

type Props = {
  // Длительность сцены из TIMING в MainSequence: на неё растягивается зум камеры.
  durationInFrames: number;
};

export const Intro: React.FC<Props> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const logo = springAt(frame, fps, INTRO_KEYFRAMES.logoIn);

  return (
    // Фон общий (MainSequence), сцена прозрачная.
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        scale: String(interpolate(frame, [0, durationInFrames], [1, CAMERA_ZOOM_TO], CLAMP)),
      }}
    >
      <div
        style={{
          opacity: interpolate(logo, [0, 1], [0, 1], CLAMP),
          scale: String(interpolate(logo, [0, 1], [0.8, 1], CLAMP)),
          marginBottom: 56,
        }}
      >
        <Logo size={128} />
      </div>
      <div
        style={{
          fontFamily: theme.font.family,
          fontSize: 96,
          fontWeight: 600,
          letterSpacing: '-0.035em',
          lineHeight: 1.12,
          textAlign: 'center',
          color: theme.color.text,
        }}
      >
        <AnimatedText
          text={INTRO.headline}
          startFrame={INTRO_KEYFRAMES.headlineIn}
          staggerFrames={INTRO_KEYFRAMES.wordStagger}
        />
        <br />
        <AnimatedText
          text={INTRO.headlineAccent}
          startFrame={INTRO_KEYFRAMES.headlineAccentIn}
          staggerFrames={INTRO_KEYFRAMES.wordStagger}
          style={{ color: theme.color.accentBright }}
        />
      </div>
    </AbsoluteFill>
  );
};
