import type React from 'react';
import { SITE_URL } from '../content';
import { theme } from '../theme';

// Высота панели браузера с точками и адресной строкой, px.
export const BROWSER_TITLEBAR_HEIGHT = 60;

type Props = {
  width: number;
  height: number;
  url?: string;
  // Содержимое вкладки. Его размер: width × (height − BROWSER_TITLEBAR_HEIGHT).
  children: React.ReactNode;
};

const DOTS = ['#FF5F57', '#FEBC2E', '#28C840'] as const;

/** Окно браузера: три точки, адресная строка и область вкладки. */
export const BrowserFrame: React.FC<Props> = ({ width, height, url = SITE_URL, children }) => (
  <div
    style={{
      width,
      height,
      borderRadius: theme.radius.window,
      background: theme.color.surface,
      border: `1px solid ${theme.color.border}`,
      boxShadow: theme.shadow.window,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: theme.font.family,
    }}
  >
    <div
      style={{
        height: BROWSER_TITLEBAR_HEIGHT,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        padding: '0 24px',
        background: theme.color.surfaceMuted,
        borderBottom: `1px solid ${theme.color.border}`,
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', gap: 9 }}>
        {DOTS.map((color) => (
          <div
            key={color}
            style={{ width: 14, height: 14, borderRadius: '50%', background: color }}
          />
        ))}
      </div>
      <div
        style={{
          position: 'absolute',
          left: '50%',
          translate: '-50% 0',
          width: 520,
          height: 36,
          borderRadius: theme.radius.pill,
          background: theme.color.surface,
          border: `1px solid ${theme.color.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          fontSize: 17,
          color: theme.color.textMuted,
        }}
      >
        <svg aria-hidden="true" width={13} height={15} viewBox="0 0 13 15">
          <rect x={1} y={6} width={11} height={8} rx={2} fill={theme.color.textFaint} />
          <path
            d="M3.5 6V4.5a3 3 0 0 1 6 0V6"
            stroke={theme.color.textFaint}
            strokeWidth={1.6}
            fill="none"
          />
        </svg>
        {url}
      </div>
    </div>
    <div
      style={{
        position: 'relative',
        flex: 1,
        overflow: 'hidden',
        background: theme.color.background,
      }}
    >
      {children}
    </div>
  </div>
);
