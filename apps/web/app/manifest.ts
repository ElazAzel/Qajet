import type { MetadataRoute } from 'next';

/**
 * PWA-манифест. Даёт установку и на ПК (оболочка консьержа как приложение),
 * и на телефон (оболочка поставщика как приложение) без Tauri/Capacitor —
 * те приходят в фазе 7 поверх этого же манифеста.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'QAJET — внешний отдел закупок',
    short_name: 'QAJET',
    description: 'Одна задача. Согласованный бюджет. Один закупочный партнёр.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#f4f4f6',
    theme_color: '#14141a',
    lang: 'ru',
    icons: [
      { src: '/icons/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/512-maskable', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
