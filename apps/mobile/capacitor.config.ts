import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Мобильная оболочка — §"Оболочка мобильного" плана, agents.md фаза 7.
 * Capacitor не умеет собрать Next.js с Server Actions в статику
 * (`webDir`/`server.url` — это webview на развёрнутый адрес, не бандл
 * фронтенда внутрь APK/IPA). Приложение открывает тот же боевой Vercel-адрес,
 * что и браузер, тем же кодом `apps/web` — плагины ниже добавляют то, что
 * веб-версии физически недоступно (push, haptics, камера, шаринг), см.
 * `apps/web/app/lib/native-bridge.ts`, который эти плагины и вызывает.
 *
 * README.md в этой папке фиксирует это прямо, а не выдаёт webview-обёртку
 * за офлайновое нативное приложение.
 */
const config: CapacitorConfig = {
  appId: 'kz.qajet.mobile',
  appName: 'QAJET',
  webDir: 'www',
  server: {
    url: 'https://qajet-seven.vercel.app',
    cleartext: false,
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    StatusBar: {
      style: 'LIGHT',
    },
  },
};

export default config;
