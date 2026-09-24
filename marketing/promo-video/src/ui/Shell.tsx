import type React from 'react';
import { SHELL } from '../content';
import { MAIN, SHELL_LAYOUT, WINDOW, WINDOW_HEIGHT } from '../lib/camera';
import { textStyle, theme } from '../theme';
import { Bell, FilePlus, ListChecks, MessageSquare, Search, Settings, Users } from './icons';

/**
 * Окно браузера с оболочкой покупателя (packages/ui/src/shell/shell-layout.tsx):
 * светлый сайдбар 240px, хедер 80px с поиском ⌘K, колокольчиком и аватаром.
 * Основная область (children) уже прокручена страницей.
 */

const NAV_ICONS = [ListChecks, FilePlus, MessageSquare, Users, Settings] as const;
const DOTS = ['#FF5F57', '#FEBC2E', '#28C840'] as const;

export const BrowserShell: React.FC<{
  url: string;
  // Индекс активного пункта навигации: 0 «Закупки», 1 «Новая заявка».
  activeNav: number;
  children: React.ReactNode;
}> = ({ url, activeNav, children }) => (
  <div
    style={{
      position: 'relative',
      width: WINDOW.width,
      height: WINDOW_HEIGHT,
      borderRadius: 14,
      overflow: 'hidden',
      background: theme.color.page,
      fontFamily: theme.font.family,
      color: theme.color.ink,
      WebkitFontSmoothing: 'antialiased',
    }}
  >
    {/* Полоса браузера: точки и адрес */}
    <div
      style={{
        position: 'absolute',
        inset: `0 0 auto 0`,
        height: WINDOW.titlebar,
        background: '#ECECEF',
        borderBottom: `1px solid ${theme.color.rule}`,
        display: 'flex',
        alignItems: 'center',
        padding: '0 18px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', gap: 8 }}>
        {DOTS.map((c) => (
          <div key={c} style={{ width: 12, height: 12, borderRadius: '50%', background: c }} />
        ))}
      </div>
      <div
        style={{
          position: 'absolute',
          left: '50%',
          translate: '-50% 0',
          width: 620,
          height: 30,
          borderRadius: 8,
          background: theme.color.surface,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: theme.color.muted,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          ...textStyle('fine'),
        }}
      >
        {url}
      </div>
    </div>

    {/* Сайдбар */}
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: WINDOW.titlebar,
        width: SHELL_LAYOUT.sidebar,
        height: WINDOW.viewportHeight,
        boxSizing: 'border-box',
        padding: '24px 16px',
        background: theme.color.surface,
        borderRight: `1px solid ${theme.color.rule}`,
      }}
    >
      <div style={{ padding: '0 8px', fontSize: 18, lineHeight: '28px', fontWeight: 800 }}>
        {SHELL.brand}
      </div>
      <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {SHELL.nav.map((label, i) => {
          const Icon = NAV_ICONS[i];
          const active = i === activeNav;
          return (
            <div
              key={label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 12px',
                borderRadius: theme.radius.control,
                fontWeight: 500,
                ...textStyle('sm'),
                background: active ? theme.color.purple10 : 'transparent',
                color: active ? theme.color.purple : theme.color.muted,
              }}
            >
              <Icon size={18} />
              {label}
            </div>
          );
        })}
      </div>
    </div>

    {/* Хедер */}
    <div
      style={{
        position: 'absolute',
        left: SHELL_LAYOUT.sidebar,
        top: WINDOW.titlebar,
        width: MAIN.width,
        height: SHELL_LAYOUT.header,
        boxSizing: 'border-box',
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: theme.color.surface,
        borderBottom: `1px solid ${theme.color.rule}`,
        zIndex: 2,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 16px',
          borderRadius: theme.radius.pill,
          background: theme.color.page,
          boxShadow: `inset 0 0 0 1px ${theme.color.rule}`,
          color: theme.color.muted,
          ...textStyle('sm'),
        }}
      >
        <Search size={16} />
        <span>{SHELL.search}</span>
        <span
          style={{
            marginLeft: 8,
            padding: '2px 6px',
            borderRadius: theme.radius.control,
            boxShadow: `inset 0 0 0 1px ${theme.color.rule}`,
            fontSize: 11,
            lineHeight: '14px',
          }}
        >
          {SHELL.shortcut}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div
          style={{
            width: 36,
            height: 36,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: theme.color.muted,
          }}
        >
          <Bell size={18} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: theme.color.purple10,
              color: theme.color.purple,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 600,
              ...textStyle('sm'),
            }}
          >
            {initials(SHELL.userName)}
          </span>
          <span style={{ ...textStyle('sm'), lineHeight: '17px' }}>
            <span style={{ display: 'block', fontWeight: 500 }}>{SHELL.userName}</span>
            <span style={{ display: 'block', ...textStyle('fine'), color: theme.color.muted }}>
              {SHELL.userMeta}
            </span>
          </span>
        </div>
      </div>
    </div>

    {/* Основная область: страница рисует себя сама и сама прокручивается */}
    <div
      style={{
        position: 'absolute',
        left: MAIN.x,
        top: MAIN.y,
        width: MAIN.width,
        height: MAIN.height,
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  </div>
);

const initials = (name: string): string =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
