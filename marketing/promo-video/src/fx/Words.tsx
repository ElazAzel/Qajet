import type React from 'react';
import { interpolate } from 'remotion';
import { CLAMP, springAt } from '../lib/motion';

/** Появление текста по словам: подъём, проявление и фокус из размытия. */
export const Words: React.FC<{
  text: string;
  frame: number;
  start: number;
  stagger?: number;
  style?: React.CSSProperties;
}> = ({ text, frame, start, stagger = 3, style }) => {
  const words = text.split(' ');
  return (
    <span style={{ display: 'inline-block', ...style }}>
      {words.map((word, i) => {
        const p = springAt(frame, start + i * stagger);
        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: слова статичны
            key={`${word}-${i}`}
            style={{
              display: 'inline-block',
              whiteSpace: 'pre',
              opacity: interpolate(p, [0, 1], [0, 1], CLAMP),
              translate: `0 ${interpolate(p, [0, 1], [0.32, 0], CLAMP)}em`,
              filter: `blur(${interpolate(p, [0, 1], [10, 0], CLAMP)}px)`,
            }}
          >
            {i < words.length - 1 ? `${word} ` : word}
          </span>
        );
      })}
    </span>
  );
};
