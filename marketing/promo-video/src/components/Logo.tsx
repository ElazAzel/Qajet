import type React from 'react';
import { theme } from '../theme';

type Props = {
  // Высота вордмарка в px (для текста это font-size).
  size: number;
  color?: string;
};

/**
 * Логотип QAJET. Сейчас это текстовый вордмарк.
 *
 * Как подставить настоящий логотип:
 * 1. положите файл в public/, например public/logo.svg;
 * 2. замените <span> ниже на
 *    <Img src={staticFile('logo.svg')} style={{ height: size }} />
 *    (Img и staticFile импортируются из 'remotion').
 * Анимацию появления делают родители, сам компонент статичен.
 */
export const Logo: React.FC<Props> = ({ size, color = theme.color.accent }) => (
  <span
    style={{
      display: 'inline-block',
      fontFamily: theme.font.family,
      fontSize: size,
      fontWeight: 700,
      letterSpacing: '-0.045em',
      lineHeight: 1,
      color,
    }}
  >
    QAJET
  </span>
);
