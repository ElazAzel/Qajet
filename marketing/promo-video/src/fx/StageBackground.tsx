import type React from 'react';
import { AbsoluteFill } from 'remotion';
import { theme } from '../theme';

/**
 * Сцена ролика: ink-фон, как у hero-баннера продукта, и едва заметная
 * точечная сетка. Статична — поэтому первый и последний кадры совпадают
 * по фону, и луп в соцсетях идёт без скачка.
 */
export const StageBackground: React.FC = () => (
  <AbsoluteFill
    style={{
      backgroundColor: theme.stage.background,
      backgroundImage: `radial-gradient(circle, ${theme.stage.dot} 1.3px, transparent 1.8px)`,
      backgroundSize: '36px 36px',
      backgroundPosition: '18px 18px',
    }}
  />
);
