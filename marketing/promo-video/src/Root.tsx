import type React from 'react';
import { Composition } from 'remotion';
import { MainSequence, TIMING } from './MainSequence';

// Размер кадра. Для вертикальной версии (1080×1920) нужна отдельная раскладка сцен.
const WIDTH = 1920;
const HEIGHT = 1080;

export const RemotionRoot: React.FC = () => (
  <Composition
    id="QajetDemo"
    component={MainSequence}
    durationInFrames={TIMING.total}
    fps={TIMING.fps}
    width={WIDTH}
    height={HEIGHT}
  />
);
