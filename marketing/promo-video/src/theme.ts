import { loadFont } from '@remotion/google-fonts/Inter';

/**
 * Дизайн-токены ролика. Цвета, радиусы, тени и шрифт меняются здесь,
 * в компонентах токены не хардкодятся.
 *
 * Акценты пока ПЛЕЙСХОЛДЕРЫ из ТЗ. Токены живого сайта лежат
 * в apps/web/app/globals.css (блок @theme): ink #14141a, purple #6c5dd3,
 * фон #f4f4f6, success #1f8a3b на #dff7e3. Чтобы перейти на цвета сайта,
 * поменяйте accent и accentBright ниже.
 */

// Шрифт. latin-ext нужен ради знака тенге ₸ (U+20B8), cyrillic для текста.
const { fontFamily } = loadFont('normal', {
  weights: ['400', '500', '600', '700'],
  subsets: ['latin', 'latin-ext', 'cyrillic'],
});

export const theme = {
  font: {
    family: fontFamily,
    // Моноширинные цифры, чтобы суммы в карточках не прыгали при анимации.
    numeric: 'tabular-nums' as const,
  },
  color: {
    background: '#f4f4f6',
    surface: '#ffffff',
    surfaceMuted: '#f7f7f9',
    text: '#1A1A2E',
    textMuted: 'rgba(26, 26, 46, 0.62)',
    textFaint: 'rgba(26, 26, 46, 0.38)',
    border: 'rgba(0, 0, 0, 0.06)',
    borderStrong: 'rgba(0, 0, 0, 0.1)',
    // Основной акцент: тёмные кнопки, логотип. Сайт: #14141a.
    accent: '#1A1A2E',
    accentText: '#ffffff',
    // Яркий акцент: бейдж «Оптимально», вторая строка заголовка. Сайт: #6c5dd3.
    accentBright: '#5B5BF7',
    accentBrightSoft: 'rgba(91, 91, 247, 0.1)',
    success: '#1f8a3b',
    successSoft: '#dff7e3',
    // Цвета градиентных blob'ов фона: пастель, без неона.
    blobs: ['#5B5BF7', '#B9A8FF', '#8EC5FF', '#FFC6D9'] as const,
  },
  radius: {
    window: 24,
    card: 22,
    control: 14,
    pill: 999,
  },
  shadow: {
    // Мягкие многослойные тени: контактная + средняя + дальняя.
    card: '0 1px 2px rgba(16, 16, 40, 0.04), 0 6px 16px rgba(16, 16, 40, 0.05), 0 24px 48px rgba(16, 16, 40, 0.06)',
    cardRaised:
      '0 2px 4px rgba(16, 16, 40, 0.05), 0 12px 28px rgba(16, 16, 40, 0.08), 0 40px 80px rgba(16, 16, 40, 0.12)',
    window:
      '0 2px 6px rgba(16, 16, 40, 0.04), 0 20px 40px rgba(16, 16, 40, 0.08), 0 60px 120px rgba(16, 16, 40, 0.12)',
    button: '0 1px 2px rgba(16, 16, 40, 0.12), 0 6px 16px rgba(16, 16, 40, 0.14)',
    toast: '0 1px 2px rgba(16, 16, 40, 0.05), 0 16px 40px rgba(16, 16, 40, 0.12)',
  },
} as const;
