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

  transpilePackages: ['@qajet/ui'],

  typedRoutes: true,

  // View Transitions в Next 16 работают без флага конфигурации — через
  // компонент `<ViewTransition>` из 'react' (App Router на React canary
  // включает его по умолчанию). Флаг experimental.viewTransition существовал
  // в более ранних версиях и был убран, когда возможность стабилизировалась.

  // Встроенная интеграция ESLint убрана из next.config в Next 16 — линт
  // ведёт Biome (biome.json в корне), отдельно от сборки Next.
  typescript: { ignoreBuildErrors: false },
};

export default withSerwist(nextConfig);
