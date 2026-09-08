'use client';

import { Share2 } from 'lucide-react';
import { shareOrder } from '../../../lib/native-bridge';

/**
 * `@capacitor/share` работает и в вебе (обёртка над `navigator.share`), не
 * только в мобильной оболочке — кнопка не скрыта под `isNativeApp()`.
 * URL собирается на клиенте (`window.location.origin`), а не приходит
 * с сервера — на превью-деплоях Vercel и на локальном `pnpm dev` домен
 * разный, а обе ссылки должны вести на тот же адрес, с которого поделились.
 */
export function ShareOrderButton({ orderId, title }: { orderId: string; title: string }) {
  return (
    <button
      type="button"
      onClick={() =>
        shareOrder({ title, url: `${window.location.origin}/buyer/orders/${orderId}` })
      }
      aria-label="Поделиться заказом"
      className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-page hover:text-ink"
    >
      <Share2 size={16} aria-hidden="true" />
    </button>
  );
}
