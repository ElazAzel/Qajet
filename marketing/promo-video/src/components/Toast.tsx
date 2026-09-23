import type React from 'react';
import { interpolate } from 'remotion';
import { DEMO } from '../content';
import { CLAMP } from '../lib/motion';
import { theme } from '../theme';

type Props = {
  // Прорисовка галочки 0 → 1 (stroke-dashoffset). Считает родитель.
  checkProgress: number;
  // Выезд, прозрачность и motion blur задаёт родитель.
  style?: React.CSSProperties;
};

/** Glass-тост уведомления: полупрозрачный фон + размытие того, что под ним. */
export const Toast: React.FC<Props> = ({ checkProgress, style }) => (
  <div
    style={{
      position: 'absolute',
      display: 'flex',
      alignItems: 'center',
      gap: 18,
      padding: '18px 30px 18px 20px',
      borderRadius: theme.radius.card,
      // Glassmorphism: светлая полупрозрачная заливка, blur фона, светлый бордер.
      background: 'rgba(255, 255, 255, 0.62)',
      backdropFilter: 'blur(24px) saturate(180%)',
      WebkitBackdropFilter: 'blur(24px) saturate(180%)',
      border: '1px solid rgba(255, 255, 255, 0.7)',
      boxShadow: `${theme.shadow.toast}, inset 0 1px 0 rgba(255, 255, 255, 0.8)`,
      fontFamily: theme.font.family,
      whiteSpace: 'nowrap',
      ...style,
    }}
  >
    <svg aria-hidden="true" width={44} height={44} viewBox="0 0 44 44">
      <circle
        cx={22}
        cy={22}
        r={20}
        fill={theme.color.successSoft}
        style={{
          scale: String(interpolate(checkProgress, [0, 0.4], [0.6, 1], CLAMP)),
          transformOrigin: '22px 22px',
        }}
      />
      <path
        d="M13 22.5l6 6 12-13"
        fill="none"
        stroke={theme.color.success}
        strokeWidth={3.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        // pathLength=1: dashoffset 1 → 0 прорисовывает галочку целиком.
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1 - checkProgress}
      />
    </svg>
    <div style={{ fontSize: 24, color: theme.color.text }}>
      <span style={{ fontWeight: 600 }}>{DEMO.toastTitle}</span>
      <span style={{ color: theme.color.textMuted }}>{` · ${DEMO.toastSubtitle}`}</span>
    </div>
  </div>
);
