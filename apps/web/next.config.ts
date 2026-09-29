import withSerwistInit from '@serwist/next';
import type { NextConfig } from 'next';

const withSerwist = withSerwistInit({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  // В dev service worker мешает горячей перезагрузке и маскирует ошибки.
  disable: process.env.NODE_ENV === 'development',
  reloadOnOnline: true,
  // В предзагрузку — только картинки из public/. Демо-ролик посадочной (2+ МБ)
  // туда попадать не должен: иначе его скачивал бы каждый, кто открыл сайт.
  globPublicPatterns: ['**/*.{webp,png,jpg,jpeg,svg,ico}'],
});

const nextConfig: NextConfig = {
  // Переносимость: образ должен запускаться на собственных серверах
  // без единой рантайм-зависимости от платформы деплоя (ADR-0002).
  output: 'standalone',

  // Каталог сборки можно увести в сторону. Нужно, когда прежний `.next` занят
  // и его нельзя ни удалить, ни переименовать: на Windows антивирус и
  // индексатор держат свежезаписанные файлы, и `next build` падает с
  // `EBUSY ... unlink`, не дойдя до компиляции. Пустая переменная — обычный
  // `.next`, поэтому CI и деплой ведут себя как раньше.
  // Ту же переменную читают scripts/prepare-standalone.mjs и playwright.config.ts.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  poweredByHeader: false,

  transpilePackages: ['@qajet/ui', '@qajet/engine', '@qajet/pd'],

  typedRoutes: true,

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
