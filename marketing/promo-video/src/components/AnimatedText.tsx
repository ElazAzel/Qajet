import type React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { CLAMP, springAt } from '../lib/motion';

type Props = {
  text: string;
  // Кадр сцены, на котором появляется первое слово.
  startFrame: number;
  // Задержка между словами в кадрах.
  staggerFrames?: number;
  style?: React.CSSProperties;
};

// На сколько (в em) слово поднимается при появлении и насколько размыто на старте.
const RISE_EM = 0.35;
const START_BLUR_PX = 10;

/**
 * Появление текста по словам: каждое слово всплывает снизу, проявляется
 * и фокусируется из размытия. Стиль (размер, цвет, вес) задаёт родитель.
 */
export const AnimatedText: React.FC<Props> = ({ text, startFrame, staggerFrames = 4, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = text.split(' ');

  return (
    <span style={{ display: 'inline-block', ...style }}>
      {words.map((word, i) => {
        const p = springAt(frame, fps, startFrame + i * staggerFrames);
        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: слова статичны, порядок не меняется
            key={`${word}-${i}`}
            style={{
              display: 'inline-block',
              whiteSpace: 'pre',
              opacity: interpolate(p, [0, 1], [0, 1], CLAMP),
              translate: `0 ${interpolate(p, [0, 1], [RISE_EM, 0], CLAMP)}em`,
              filter: `blur(${interpolate(p, [0, 1], [START_BLUR_PX, 0], CLAMP)}px)`,
            }}
          >
            {i < words.length - 1 ? `${word} ` : word}
          </span>
        );
      })}
    </span>
  );
};
