'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Общая обёртка над server action, возвращающим `{ok, error}` — три места
 * в apps/web (кнопки заказа: предложить план, продвинуть стадию, утвердить/
 * принять/закрыть) копировали один и тот же pending/error стейт-машин.
 * Успех — `router.refresh()` (Server Component перечитывает данные), отказ —
 * текст причины остаётся в `error`, вызывающий компонент сам решает, где
 * его показать.
 */

export interface AsyncActionResult {
  ok: boolean;
  error?: string;
}

export function useAsyncAction<
  Args extends unknown[],
  R extends AsyncActionResult = AsyncActionResult,
>(
  action: (...args: Args) => Promise<R>,
  /** Действие создало что-то новое (заявку, заказ) — получить результат для
   *  навигации/сообщения вместо (или вместе с) обновлением текущей страницы. */
  onSuccess?: (result: R) => void,
) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(...args: Args): Promise<void> {
    setPending(true);
    setError(null);
    const result = await action(...args);
    if (result.ok) {
      onSuccess?.(result);
      router.refresh();
      setPending(false);
      return;
    }
    setPending(false);
    setError(result.error ?? 'Не удалось выполнить действие');
  }

  return { run, pending, error };
}
