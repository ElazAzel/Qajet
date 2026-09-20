import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPasswordPwned, pwnedPasswordPrefix } from './pwned-password';

/**
 * Бесплатная замена платной защите Supabase от утёкших паролей.
 *
 * Главное свойство — сам пароль наружу не уходит: сервису отправляются первые
 * пять шестнадцатеричных знаков SHA-1, он возвращает все суффиксы своего
 * диапазона, сравнение делается локально (k-анонимность). Тест на это стоит
 * первым: если реализация начнёт отправлять пароль целиком, он покраснеет.
 *
 * Второе свойство — отказ сервиса не запирает человека без пароля. Проверка
 * необязательная: сеть недоступна — пароль принимается, как и до неё.
 */

const SHA1_OF_PASSWORD = '5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8'; // "password"
const SUFFIX = SHA1_OF_PASSWORD.slice(5);

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubRange(body: string, init: { status?: number } = {}) {
  // Параметр объявлен явно: без него у мока пустой тип аргументов, и проверить,
  // какой адрес запрашивали, нельзя.
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(body, { status: init.status ?? 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('pwnedPasswordPrefix', () => {
  it('отдаёт ровно пять знаков SHA-1 в верхнем регистре', async () => {
    expect(await pwnedPasswordPrefix('password')).toBe(SHA1_OF_PASSWORD.slice(0, 5));
  });
});

describe('isPasswordPwned', () => {
  it('наружу уходит только пятизначный префикс — ни пароля, ни полного хеша', async () => {
    const fetchMock = stubRange(`${SUFFIX}:37359195`);
    await isPasswordPwned('password');

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${SHA1_OF_PASSWORD.slice(0, 5)}`);
    // Проверяем путь, а не ссылку целиком: слово «password» есть в самом имени
    // домена pwnedpasswords.com, и проверка по всей строке была бы ложной.
    const { pathname, search } = new URL(url);
    expect(pathname + search).not.toContain('password');
    expect(pathname + search).not.toContain(SUFFIX);
    expect(pathname).toHaveLength('/range/'.length + 5);
  });

  it('находит пароль, когда его суффикс есть в ответе', async () => {
    stubRange(`0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n${SUFFIX}:37359195`);
    expect(await isPasswordPwned('password')).toBe(true);
  });

  it('не находит пароль, которого в диапазоне нет', async () => {
    stubRange('0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2');
    expect(await isPasswordPwned('password')).toBe(false);
  });

  it('сравнение суффикса не зависит от регистра ответа', async () => {
    stubRange(`${SUFFIX.toLowerCase()}:5`);
    expect(await isPasswordPwned('password')).toBe(true);
  });

  it('счётчик 0 не считается утечкой', async () => {
    stubRange(`${SUFFIX}:0`);
    expect(await isPasswordPwned('password')).toBe(false);
  });

  it('недоступный сервис не запирает человека: пароль считается неизвестным', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    expect(await isPasswordPwned('password')).toBe(false);
  });

  it('ответ не 200 тоже не блокирует', async () => {
    stubRange('', { status: 503 });
    expect(await isPasswordPwned('password')).toBe(false);
  });
});
