import type React from 'react';
import { interpolate } from 'remotion';
import { CLAMP, EASE_OUT, progress, springAt } from '../lib/motion';
import { theme } from '../theme';

/**
 * Экранные слои ролика: прожектор, подпись шага, счётчик таймлапса,
 * отметка аудита. Стиль — фирменные ink + lime (лайм только на тёмном, §12).
 */

export type ScreenRect = { x: number; y: number; w: number; h: number };

/** Прожектор: всё вокруг прямоугольника притемняется. */
export const Spotlight: React.FC<{ rect: ScreenRect; strength: number; radius?: number }> = ({
  rect,
  strength,
  radius = 18,
}) => {
  if (strength <= 0) return null;
  const pad = 14;
  return (
    <div
      style={{
        position: 'absolute',
        left: rect.x - pad,
        top: rect.y - pad,
        width: rect.w + pad * 2,
        height: rect.h + pad * 2,
        borderRadius: radius,
        boxShadow: `0 0 0 4000px rgba(20, 20, 26, ${0.5 * strength}), 0 0 0 2px rgba(214, 255, 63, ${0.9 * strength})`,
        zIndex: 30,
      }}
    />
  );
};

/** Подпись шага: номер шага лаймом, заголовок и пояснение на ink-капсуле. */
export const Caption: React.FC<{
  frame: number;
  start: number;
  end: number;
  step: string;
  title: string;
  sub: string;
  // true — у верхнего края кадра, иначе у нижнего.
  top?: boolean;
}> = ({ frame, start, end, step, title, sub, top = false }) => {
  if (frame < start || frame > end) return null;
  const inP = springAt(frame, start);
  const outP = progress(frame, end - 10, 10);
  const titleWords = title.split(' ');
  return (
    <div
      style={{
        position: 'absolute',
        left: 64,
        ...(top ? { top: 64 } : { bottom: 64 }),
        display: 'flex',
        alignItems: 'stretch',
        gap: 0,
        borderRadius: theme.radius.hero,
        background: theme.color.ink,
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.45)',
        overflow: 'hidden',
        opacity: interpolate(inP, [0, 1], [0, 1], CLAMP) * (1 - outP),
        translate: `${interpolate(inP, [0, 1], [-40, 0], CLAMP) - outP * 30}px 0`,
        fontFamily: theme.font.family,
        zIndex: 80,
      }}
    >
      <div
        style={{
          width: 88,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: theme.color.lime,
          color: theme.color.ink,
          fontSize: 44,
          fontWeight: 800,
        }}
      >
        {step}
      </div>
      <div style={{ padding: '22px 32px 24px 28px' }}>
        <div
          style={{
            fontSize: 40,
            lineHeight: '46px',
            fontWeight: 800,
            color: theme.color.white,
            letterSpacing: '-0.01em',
          }}
        >
          {titleWords.map((w, i) => {
            const p = springAt(frame, start + 4 + i * 3);
            return (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: слова статичны
                key={`${w}-${i}`}
                style={{
                  display: 'inline-block',
                  whiteSpace: 'pre',
                  opacity: p,
                  translate: `0 ${(1 - p) * 14}px`,
                }}
              >
                {i < titleWords.length - 1 ? `${w} ` : w}
              </span>
            );
          })}
        </div>
        <div
          style={{
            marginTop: 6,
            fontSize: 24,
            lineHeight: '30px',
            color: 'rgba(255, 255, 255, 0.68)',
            opacity: progress(frame, start + 10, 10),
          }}
        >
          {sub}
        </div>
      </div>
    </div>
  );
};

/** Счётчик таймлапса: даты «пролистываются», пока QAJET работает. */
export const Timelapse: React.FC<{
  frame: number;
  start: number;
  end: number;
  dates: readonly string[];
}> = ({ frame, start, end, dates }) => {
  if (frame < start || frame > end) return null;
  const inP = springAt(frame, start);
  const outP = progress(frame, end - 8, 8);
  const pos = interpolate(frame, [start + 6, end - 10], [0, dates.length - 1], CLAMP);
  const idx = Math.floor(pos);
  const frac = pos - idx;
  // Дата прокручивается вверх в последней трети каждого шага.
  const roll = interpolate(frac, [0.6, 1], [0, 1], { ...CLAMP, easing: EASE_OUT });
  const current = dates[idx];
  const next = dates[Math.min(idx + 1, dates.length - 1)];
  return (
    <div
      style={{
        position: 'absolute',
        right: 64,
        top: 56,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '14px 24px 14px 18px',
        borderRadius: theme.radius.pill,
        background: theme.color.ink,
        boxShadow: '0 16px 48px rgba(0, 0, 0, 0.45)',
        fontFamily: theme.font.family,
        opacity: inP * (1 - outP),
        translate: `0 ${(1 - inP) * -24}px`,
        zIndex: 80,
      }}
    >
      <FastForward frame={frame} />
      <div style={{ position: 'relative', height: 40, width: 150, overflow: 'hidden' }}>
        {[current, next].map((d, i) => (
          <div
            key={`${d}-${i === 0 ? 'now' : 'next'}`}
            style={{
              position: 'absolute',
              left: 0,
              top: (i - roll) * 40,
              height: 40,
              fontSize: 32,
              lineHeight: '40px',
              fontWeight: 800,
              color: theme.color.white,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            }}
          >
            {d}
          </div>
        ))}
      </div>
    </div>
  );
};

// Значок перемотки: два треугольника, мигают по очереди.
const FastForward: React.FC<{ frame: number }> = ({ frame }) => {
  const phase = Math.floor(frame / 5) % 2;
  return (
    <svg aria-hidden="true" width={34} height={24} viewBox="0 0 34 24">
      <path d="M2 2 L15 12 L2 22 Z" fill={theme.color.lime} opacity={phase === 0 ? 1 : 0.45} />
      <path d="M17 2 L30 12 L17 22 Z" fill={theme.color.lime} opacity={phase === 1 ? 1 : 0.45} />
    </svg>
  );
};

/** Отметка аудита после подтверждения: «кто, когда, какая версия». */
export const AuditStamp: React.FC<{
  frame: number;
  start: number;
  end: number;
  title: string;
  sub: string;
}> = ({ frame, start, end, title, sub }) => {
  if (frame < start || frame > end) return null;
  const inP = springAt(frame, start, { damping: 14, stiffness: 180 });
  const outP = progress(frame, end - 8, 8);
  const check = progress(frame, start + 6, 12);
  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: 96,
        translate: `-50% ${(1 - inP) * -40}px`,
        scale: String(interpolate(inP, [0, 1], [0.9, 1], CLAMP)),
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        padding: '18px 30px 18px 20px',
        borderRadius: theme.radius.hero,
        background: theme.color.ink,
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.45)',
        opacity: inP * (1 - outP),
        fontFamily: theme.font.family,
        zIndex: 85,
      }}
    >
      <svg aria-hidden="true" width={52} height={52} viewBox="0 0 52 52">
        <circle cx={26} cy={26} r={24} fill={theme.color.lime} />
        <path
          d="M15 26.5l7.5 7.5 15-16"
          fill="none"
          stroke={theme.color.ink}
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - check}
        />
      </svg>
      <div>
        <div
          style={{ fontSize: 30, lineHeight: '36px', fontWeight: 800, color: theme.color.white }}
        >
          {title}
        </div>
        <div style={{ fontSize: 22, lineHeight: '28px', color: 'rgba(255, 255, 255, 0.68)' }}>
          {sub}
        </div>
      </div>
    </div>
  );
};
