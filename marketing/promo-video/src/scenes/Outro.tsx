import type React from 'react';
import { AbsoluteFill, Freeze, interpolate, useCurrentFrame } from 'remotion';
import { LANDING, SITE_HOST } from '../content';
import { Words } from '../fx/Words';
import { CLAMP, EASE_IN_OUT, springAt } from '../lib/motion';
import { theme } from '../theme';
import { Check } from '../ui/icons';

// Ключевые кадры аутро (локальные кадры сцены).
// Первые ~18 кадров аутро проявляется поверх пути покупателя (fade в MainSequence).
export const OUTRO_KEYFRAMES = {
  logoIn: 6,
  subtitleIn: 12,
  wordStagger: 3,
  reasonsIn: 34,
  reasonStagger: 6,
  ctaIn: 54,
  urlIn: 64,
  shineStart: 74,
  shineEnd: 100,
} as const;

// Последние кадры — стоп-кадр без движения, чтобы ролик чисто зацикливался.
export const OUTRO_HOLD_FRAMES = 10;

type Props = { durationInFrames: number };

const OutroContent: React.FC<{ freezeFrom: number }> = ({ freezeFrom }) => {
  const frame = useCurrentFrame();
  const K = OUTRO_KEYFRAMES;
  const logo = springAt(frame, K.logoIn);
  const cta = springAt(frame, K.ctaIn, { damping: 13, stiffness: 180 });

  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: theme.font.family,
        color: theme.color.white,
        scale: String(interpolate(frame, [0, freezeFrom], [1, 1.04], CLAMP)),
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 150,
          fontSize: 64,
          fontWeight: 800,
          letterSpacing: '-0.02em',
          opacity: logo,
          scale: String(interpolate(logo, [0, 1], [0.8, 1], CLAMP)),
        }}
      >
        QAJET
      </div>

      <div
        style={{
          fontSize: 84,
          lineHeight: 1.1,
          fontWeight: 800,
          letterSpacing: '-0.02em',
          textAlign: 'center',
          marginTop: 20,
        }}
      >
        <Words text={LANDING.eyebrow} frame={frame} start={K.subtitleIn} stagger={K.wordStagger} />
      </div>

      {/* Три отличия с лендинга */}
      <div style={{ display: 'flex', gap: 36, marginTop: 44 }}>
        {LANDING.reasons.map((reason, i) => {
          const p = springAt(frame, K.reasonsIn + i * K.reasonStagger);
          return (
            <div
              key={reason}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                fontSize: 28,
                fontWeight: 600,
                color: 'rgba(255, 255, 255, 0.82)',
                opacity: p,
                translate: `0 ${(1 - p) * 16}px`,
              }}
            >
              <span
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: '50%',
                  background: theme.color.lime,
                  color: theme.color.ink,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Check size={20} strokeWidth={3} />
              </span>
              {reason}
            </div>
          );
        })}
      </div>

      {/* CTA: лайм на ink (§12), затем блик */}
      <div
        style={{
          position: 'relative',
          overflow: 'hidden',
          marginTop: 60,
          height: 96,
          padding: '0 52px',
          display: 'flex',
          alignItems: 'center',
          borderRadius: theme.radius.hero,
          background: theme.color.lime,
          color: theme.color.ink,
          fontSize: 36,
          fontWeight: 700,
          opacity: interpolate(cta, [0, 1], [0, 1], CLAMP),
          scale: String(interpolate(cta, [0, 1], [0.86, 1], CLAMP)),
          translate: `0 ${interpolate(cta, [0, 1], [24, 0], CLAMP)}px`,
        }}
      >
        {LANDING.cta}
        <div
          style={{
            position: 'absolute',
            top: '-50%',
            left: 0,
            width: 120,
            height: '200%',
            rotate: '20deg',
            background:
              'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.7) 50%, rgba(255,255,255,0) 100%)',
            translate: `${interpolate(frame, [K.shineStart, K.shineEnd], [-200, 560], {
              ...CLAMP,
              easing: EASE_IN_OUT,
            })}px 0`,
          }}
        />
      </div>

      <div
        style={{
          marginTop: 30,
          fontSize: 30,
          fontWeight: 500,
          color: 'rgba(255, 255, 255, 0.6)',
          opacity: interpolate(frame, [K.urlIn, K.urlIn + 12], [0, 1], CLAMP),
        }}
      >
        {SITE_HOST}
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
