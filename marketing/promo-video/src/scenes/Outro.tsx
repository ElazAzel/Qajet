import type React from 'react';
import { AbsoluteFill, Freeze, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { AnimatedText } from '../components/AnimatedText';
import { Logo } from '../components/Logo';
import { OUTRO } from '../content';
import { CLAMP, EASE_IN_OUT, springAt } from '../lib/motion';
import { theme } from '../theme';

// Ключевые кадры аутро (локальные кадры сцены, 30 fps).
// Первые ~20 кадров аутро проявляется поверх демо (fade в MainSequence).
export const OUTRO_KEYFRAMES = {
  logoIn: 6,
  subtitleIn: 14,
  wordStagger: 4,
  ctaIn: 34,
  urlIn: 46,
  // Блик проходит по кнопке.
  shineStart: 58,
  shineEnd: 84,
} as const;

// Последние кадры ролика — стоп-кадр без движения, чтобы видео чисто зацикливалось.
export const OUTRO_HOLD_FRAMES = 10;

// Зум камеры внутри сцены: из ТЗ, 1 → 1.04.
const CAMERA_ZOOM_TO = 1.04;

type Props = {
  // Длительность сцены из TIMING в MainSequence. Стоп-кадр = последние OUTRO_HOLD_FRAMES.
  durationInFrames: number;
};

const OutroContent: React.FC<{ freezeFrom: number }> = ({ freezeFrom }) => {
  // Внутри <Freeze> кадр после freezeFrom не растёт: вся сцена замирает.
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const K = OUTRO_KEYFRAMES;
  const logo = springAt(frame, fps, K.logoIn);
  const cta = springAt(frame, fps, K.ctaIn);

  return (
    // Фон общий (MainSequence), сцена прозрачная.
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: theme.font.family,
        scale: String(interpolate(frame, [0, freezeFrom], [1, CAMERA_ZOOM_TO], CLAMP)),
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 170,
          opacity: interpolate(logo, [0, 1], [0, 1], CLAMP),
          scale: String(interpolate(logo, [0, 1], [0.8, 1], CLAMP)),
        }}
      >
        <Logo size={60} />
      </div>

      <div
        style={{
          fontSize: 80,
          fontWeight: 600,
          letterSpacing: '-0.035em',
          color: theme.color.text,
          textAlign: 'center',
          marginTop: 40,
        }}
      >
        <AnimatedText
          text={OUTRO.subtitle}
          startFrame={K.subtitleIn}
          staggerFrames={K.wordStagger}
        />
      </div>

      {/* CTA: появление пружиной, затем по кнопке проходит блик */}
      <div
        style={{
          position: 'relative',
          overflow: 'hidden',
          marginTop: 64,
          height: 100,
          padding: '0 56px',
          display: 'flex',
          alignItems: 'center',
          borderRadius: theme.radius.card,
          background: theme.color.accent,
          color: theme.color.accentText,
          boxShadow: theme.shadow.cardRaised,
          fontSize: 36,
          fontWeight: 600,
          letterSpacing: '-0.01em',
          opacity: interpolate(cta, [0, 1], [0, 1], CLAMP),
          scale: String(interpolate(cta, [0, 1], [0.88, 1], CLAMP)),
          translate: `0 ${interpolate(cta, [0, 1], [24, 0], CLAMP)}px`,
        }}
      >
        {OUTRO.cta}
        <div
          style={{
            position: 'absolute',
            top: '-50%',
            left: 0,
            width: 140,
            height: '200%',
            rotate: '20deg',
            background:
              'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.38) 50%, rgba(255,255,255,0) 100%)',
            translate: `${interpolate(frame, [K.shineStart, K.shineEnd], [-220, 640], {
              ...CLAMP,
              easing: EASE_IN_OUT,
            })}px 0`,
          }}
        />
      </div>

      <div
        style={{
          marginTop: 36,
          fontSize: 30,
          fontWeight: 500,
          color: theme.color.textMuted,
          opacity: interpolate(frame, [K.urlIn, K.urlIn + 14], [0, 1], CLAMP),
        }}
      >
        {OUTRO.url}
      </div>
    </AbsoluteFill>
  );
};

export const Outro: React.FC<Props> = ({ durationInFrames }) => {
  const freezeFrom = durationInFrames - OUTRO_HOLD_FRAMES;
  return (
    <Freeze frame={freezeFrom} active={(f) => f >= freezeFrom}>
      <OutroContent freezeFrom={freezeFrom} />
    </Freeze>
  );
};
