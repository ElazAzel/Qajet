'use client';

/**
 * Мост к нативным возможностям мобильной оболочки (apps/mobile, Capacitor 8).
 * Один и тот же код apps/web работает и в обычном браузере, и внутри
 * Capacitor-приложения — `Capacitor.isNativePlatform()` возвращает false
 * в браузере, все функции ниже безопасно ничего не делают вне обёртки.
 *
 * Импорт `@capacitor/core` в чистом браузере не ломает сборку и не требует
 * условной загрузки: пакет специально спроектирован работать «в вебе» как
 * no-op платформа. Плагины (`status-bar`, `push-notifications`, `haptics`)
 * догружаются динамически — их нативной части всё равно неоткуда взяться
 * без Capacitor-раннера, незачем инициализировать на каждой обычной загрузке
 * сайта.
 */
import { Capacitor } from '@capacitor/core';

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/** Вызывается один раз в Providers — регистрация push, стиль статус-бара. */
export async function initNativeApp(): Promise<void> {
  if (!isNativeApp()) return;

  const { StatusBar, Style } = await import('@capacitor/status-bar');
  await StatusBar.setStyle({ style: Style.Light }).catch(() => {});

  const { PushNotifications } = await import('@capacitor/push-notifications');
  const permission = await PushNotifications.checkPermissions();
  if (permission.receive === 'prompt') {
    await PushNotifications.requestPermissions();
  }
  if (permission.receive === 'granted' || permission.receive === 'prompt') {
    await PushNotifications.register().catch(() => {});
  }

  // Честно: сервер пока не умеет принимать и хранить токен устройства —
  // `/admin/outbox` (agents.md §9) шлёт уведомления в почту/outbox-таблицу,
  // но не push. Эндпоинт регистрации токена — открытый пункт, см.
  // apps/mobile/README.md. Пока не теряем событие молча и не падаем.
  PushNotifications.addListener('registration', (token) => {
    console.warn('[qajet] push token получен, отправка на сервер не реализована:', token.value);
  });
  PushNotifications.addListener('registrationError', (error) => {
    console.error('[qajet] push registration error', error);
  });
}

/** Тактильный отклик на успешное действие — только у нативного приложения. */
export async function hapticSuccess(): Promise<void> {
  if (!isNativeApp()) return;
  const { Haptics, NotificationType } = await import('@capacitor/haptics');
  await Haptics.notification({ type: NotificationType.Success }).catch(() => {});
}

/**
 * Системный шаринг ссылки на заказ. `@capacitor/share` несёт и веб-реализацию
 * (обёртку над `navigator.share`), поэтому работает и в обычном браузере —
 * это не Capacitor-специфичная функция, а сознательно единая точка вызова.
 */
export async function shareOrder(params: {
  title: string;
  text?: string;
  url: string;
}): Promise<void> {
  const { Share } = await import('@capacitor/share');
  const canShare = await Share.canShare().catch(() => ({ value: false }));
  if (!canShare.value) return;
  await Share.share(params).catch(() => {});
}
