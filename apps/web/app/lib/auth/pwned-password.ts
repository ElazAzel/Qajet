/**
 * Проверка пароля по базе утечек Have I Been Pwned — бесплатная замена
 * платной защите Supabase (`auth_leaked_password_protection`, тариф Pro).
 *
 * k-анонимность. Сам пароль и его полный хеш не покидают сервер: наружу уходят
 * первые пять знаков SHA-1, сервис возвращает ВСЕ суффиксы своего диапазона
 * (несколько сотен), совпадение ищется локально. По префиксу нельзя понять,
 * какой пароль проверяли.
 *
 * Проверка необязательная и отказывает в сторону пользователя. Если сервис
 * недоступен, ответ не 200 или тело нечитаемо, функция возвращает false —
 * «про утечку неизвестно». Иначе сбой внешней сети запирал бы человека без
 * пароля: agents.md требует, чтобы внешняя служба не ломала основной путь.
 *
 * Вызывается только на сервере: fetch идёт с сервера, из браузера пароль
 * никуда не отправляется.
 */

const RANGE_ENDPOINT = 'https://api.pwnedpasswords.com/range';
const PREFIX_LENGTH = 5;
const TIMEOUT_MS = 2500;

/** Первые пять знаков SHA-1 в верхнем регистре — единственное, что уходит наружу. */
export async function pwnedPasswordPrefix(password: string): Promise<string> {
  return (await sha1Hex(password)).slice(0, PREFIX_LENGTH);
}

async function sha1Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/**
 * true — пароль встречается в известных утечках. false — не встречается ЛИБО
 * проверить не удалось: эти два случая намеренно не различаются, чтобы вызов
 * никогда не блокировал установку пароля из-за чужой недоступности.
 */
export async function isPasswordPwned(password: string): Promise<boolean> {
  if (!password) return false;

  const hash = await sha1Hex(password);
  const prefix = hash.slice(0, PREFIX_LENGTH);
  const suffix = hash.slice(PREFIX_LENGTH);

  try {
    const response = await fetch(`${RANGE_ENDPOINT}/${prefix}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'Add-Padding': 'true' },
      cache: 'no-store',
    });
    if (!response.ok) return false;

    for (const line of (await response.text()).split('\n')) {
      const [candidate, count] = line.trim().split(':');
      if (candidate?.toUpperCase() !== suffix) continue;
      // Дополнение (`Add-Padding`) приходит со счётчиком 0 — это не утечка,
      // а строки-пустышки, которыми сервис скрывает размер настоящего ответа.
      return Number(count) > 0;
    }
    return false;
  } catch {
    // Сеть, таймаут, нечитаемое тело — «неизвестно», а не «запрещено».
    return false;
  }
}
