import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Подписанная ссылка без входа — общий примитив для двух мест из
 * agents.md: временная ссылка на `/metrics` для жюри (§9) и
 * двухступенчатый ответ поставщика на RFQ по защищённой ссылке (§10).
 *
 * HMAC-SHA256 поверх `{scope, payload, exp}`, без внешних зависимостей
 * (`jsonwebtoken` и т.п. не нужен — формат проще JWT: нет алгоритмов на
 * выбор, значит нет и класса уязвимостей вокруг `alg: none`). `scope` —
 * не опция, а обязательная часть подписанной нагрузки: токен для
 * `/metrics` не должен провериться как валидный где-то ещё, даже если
 * секрет утечёт вместе с одним конкретным токеном.
 *
 * `LINK_SIGNING_SECRET` — обязателен в проде. Только в разработке используется
 * фиксированная dev-заглушка (agents.md §2: проект обязан запускаться
 * без единого внешнего ключа) — она НЕ секрет, любой, кто читал этот
 * файл, может подделать токен, если реальный секрет не задан.
 */

const DEV_FALLBACK_SECRET = 'qajet-dev-only-insecure-link-signing-secret-do-not-use-in-prod';

function getSecret(): string {
  if (!process.env.LINK_SIGNING_SECRET && process.env.NODE_ENV === 'production') {
    throw new Error('LINK_SIGNING_SECRET не задан — подписанные ссылки отключены.');
  }
  return process.env.LINK_SIGNING_SECRET || DEV_FALLBACK_SECRET;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function sign(bodyB64: string): Buffer {
  return createHmac('sha256', getSecret()).update(bodyB64).digest();
}

interface SignedLinkBody<T> {
  scope: string;
  payload: T;
  /** Unix-секунды, когда токен перестаёт быть валидным. */
  exp: number;
}

/** Создаёт подписанный токен со сроком действия. Возвращает сам токен, не URL — вызывающий код решает, куда его подставить. */
export function createSignedLink<T>(scope: string, payload: T, ttlSeconds: number): string {
  const body: SignedLinkBody<T> = {
    scope,
    payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const bodyB64 = base64url(Buffer.from(JSON.stringify(body), 'utf8'));
  const sigB64 = base64url(sign(bodyB64));
  return `${bodyB64}.${sigB64}`;
}

/**
 * Проверяет токен: подпись, скоуп, срок действия. Возвращает payload
 * только если все три проверки прошли — иначе null, без деталей о том,
 * какая именно проверка не прошла (не давать атакующему обратную связь).
 */
export function verifySignedLink<T>(token: string, expectedScope: string): T | null {
  if (!process.env.LINK_SIGNING_SECRET && process.env.NODE_ENV === 'production') return null;
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  const dotIndex = token.indexOf('.');
  if (dotIndex === -1) return null;
  const bodyB64 = token.slice(0, dotIndex);
  const sigB64 = token.slice(dotIndex + 1);
  if (!bodyB64 || !sigB64) return null;

  let providedSig: Buffer;
  try {
    providedSig = Buffer.from(sigB64, 'base64url');
  } catch {
    return null;
  }
  const expectedSig = sign(bodyB64);
  if (providedSig.length !== expectedSig.length || !timingSafeEqual(providedSig, expectedSig)) {
    return null;
  }

  let body: Partial<SignedLinkBody<T>> | null;
  try {
    body = JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object' || body.scope !== expectedScope) return null;
  if (typeof body.exp !== 'number' || !Number.isSafeInteger(body.exp)) return null;
  if (Math.floor(Date.now() / 1000) >= body.exp) return null;
  return body.payload ?? null;
}
