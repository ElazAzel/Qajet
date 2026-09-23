import { loadFont } from '@remotion/google-fonts/Arimo';

/**
 * Токены ролика = токены продукта. Источник истины:
 * docs/product/qajet-master-spec.md §12 и apps/web/app/globals.css (@theme).
 * Если в продукте поменяли токен, поменяйте его и здесь.
 *
 * Шрифт. Продукт намеренно использует системный стек с Helvetica Neue
 * (§12, «ноль внешней загрузки»). На macOS ролик рендерится ровно им.
 * Там, где Helvetica Neue нет (Linux, CI), подставляется Arimo: он
 * метрически совместим с Helvetica/Arial и умеет кириллицу. latin-ext
 * нужен ради знака тенге ₸ (U+20B8).
 */
const { fontFamily: fallbackFamily } = loadFont('normal', {
  weights: ['400', '500', '600', '700'],
  subsets: ['latin', 'latin-ext', 'cyrillic'],
});

export const theme = {
  font: {
    family: `"Helvetica Neue", Helvetica, ${fallbackFamily}, Arial, sans-serif`,
  },
  color: {
    ink: '#14141A',
    purple: '#6C5DD3',
    lime: '#D6FF3F',
    purple10: '#EDEBFB',
    page: '#F4F4F6',
    surface: '#FFFFFF',
    rule: 'rgba(20, 20, 26, 0.08)',
    muted: 'rgba(20, 20, 26, 0.62)',
    signal: '#C23A3A',
    white: '#FFFFFF',
  },
  // Статусные пары §12: фон и текст пилюли всегда вместе.
  status: {
    neutral: { bg: '#F0F0F2', fg: 'rgba(20, 20, 26, 0.6)' },
    progress: { bg: '#EDEBFB', fg: '#6C5DD3' },
    success: { bg: '#DFF7E3', fg: '#1F8A3B' },
    pending: { bg: '#FFEFD6', fg: '#B36A16' },
    done: { bg: '#EAF1FF', fg: '#2A5FCB' },
    signal: { bg: '#FDE3E3', fg: '#C23A3A' },
  },
  radius: { control: 10, card: 16, cardSm: 14, hero: 20, pill: 100 },
  // Шкала Tailwind из globals.css: [размер, межстрочный].
  text: {
    micro: [11, 16],
    fine: [13, 18],
    sm: [14, 20],
    base: [16, 24],
    lg: [18, 28],
    xl: [20, 28],
    '2xl': [24, 32],
    '3xl': [30, 36],
  },
  // Единственная тень продукта — под оверлеем (globals.css, shadow-overlay).
  shadow: {
    overlay: '0 1px 2px rgba(20, 20, 26, 0.08), 0 12px 32px -8px rgba(20, 20, 26, 0.22)',
  },
  // Слой ролика, не продукта: сцена, на которой «висит» окно браузера.
  stage: {
    background: '#14141A',
    dot: 'rgba(255, 255, 255, 0.07)',
    windowShadow: '0 40px 120px rgba(0, 0, 0, 0.55), 0 12px 32px rgba(0, 0, 0, 0.35)',
    dim: 'rgba(20, 20, 26, 0.55)',
  },
} as const;

export type StatusTone = keyof typeof theme.status;
export type TextSize = keyof typeof theme.text;

/** Стиль текста по шкале продукта: fontSize + lineHeight. */
export const textStyle = (size: TextSize): { fontSize: number; lineHeight: string } => ({
  fontSize: theme.text[size][0],
  lineHeight: `${theme.text[size][1]}px`,
});
