import withSerwistInit from '@serwist/next';
import type { NextConfig } from 'next';

const withSerwist = withSerwistInit({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  // В dev service worker мешает горячей перезагрузке и маскирует ошибки.
  disable: process.env.NODE_ENV === 'development',
  reloadOnOnline: true,
});

const nextConfig: NextConfig = {
  // Переносимость: образ должен запускаться на собственных серверах
  // без единой рантайм-зависимости от платформы деплоя (ADR-0002).
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,

  transpilePackages: ['@qajet/ui', '@qajet/engine', '@qajet/pd'],

  typedRoutes: true,

  // Загрузка вложения — Server Action, а по умолчанию он принимает тело до 1 МБ.
  // Приложение разрешает файлы до 10 МБ (MAX_ATTACHMENT_BYTES), поэтому обычный
  // PDF или фото свыше 1 МБ получал 413 и пропадал молча: ни вложения, ни ошибки.
  // Лимит чуть выше файла, чтобы запас на поля формы не резал файл ровно в 10 МБ.
  // Размер сверх лимита ловит форма в браузере (_attachment-form.tsx); сервер держит
  // тот же лимит для клиентов без JavaScript.
  // Ограничение глобальное: у Next нет лимита на отдельное действие, поэтому он
  // расширен для ВСЕХ Server Actions, а загрузка до 10 МБ буферизуется в памяти.
  experimental: { serverActions: { bodySizeLimit: '11mb' } },

  // View Transitions в Next 16 работают без флага конфигурации — через
  // компонент `<ViewTransition>` из 'react' (App Router на React canary
  // включает его по умолчанию). Флаг experimental.viewTransition существовал
  // в более ранних версиях и был убран, когда возможность стабилизировалась.

  // Встроенная интеграция ESLint убрана из next.config в Next 16 — линт
  // ведёт Biome (biome.json в корне), отдельно от сборки Next.
  typescript: { ignoreBuildErrors: false },

  // packages/engine — чистый ESM с explicit-.js относительными импортами
  // (NodeNext-стиль: файл на диске .ts, импорт пишется как .js). tsc/vitest
  // это понимают из коробки, а webpack — нет, даже под transpilePackages,
  // без явного extensionAlias: он ищет буквальный ../money/index.js рядом
  // с .ts-исходником и не находит.
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default withSerwist(nextConfig);
