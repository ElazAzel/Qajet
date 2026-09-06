import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { NetworkOnly, Serwist } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * Оболочка приложения обязана открываться офлайн (agents.md §2, §13:
 * "на сцене Wi-Fi всегда падает"). Данные при этом НЕ кэшируются здесь —
 * они идут через Server Actions к Supabase, у которого своя семантика
 * согласованности. Кэшируется ровно оболочка: JS/CSS/шрифты/иконки,
 * чтобы приложение включалось и показывало последнее известное состояние,
 * а не белый экран без сети.
 */
export const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST ?? [],
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // Server Actions и мутации никогда не отвечают из кэша — иначе заказ
    // можно «утвердить» офлайн и не узнать об этом.
    {
      matcher: ({ request }) => request.method !== 'GET',
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
});

serwist.addEventListeners();
