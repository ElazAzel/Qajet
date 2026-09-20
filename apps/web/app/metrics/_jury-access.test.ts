import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignedLink } from '../lib/signed-link';
import { createJuryMetricsClient, JURY_LINK_TTL_SECONDS, JURY_SCOPE } from './_jury-access';

/**
 * createJuryMetricsClient() возвращает клиент под service_role, то есть в обход
 * RLS. Раньше единственной защитой было то, что вызывающий не забыл вызвать
 * isValidJuryToken() перед ним: забытая проверка открыла бы метрики любому.
 * Теперь проверка токена — часть самой фабрики.
 */
describe('createJuryMetricsClient', () => {
  beforeEach(() => {
    vi.stubEnv('LINK_SIGNING_SECRET', 'test-secret-for-jury-access-unit-tests');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key-for-unit-tests');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const validToken = () => createSignedLink(JURY_SCOPE, {}, JURY_LINK_TTL_SECONDS);

  it('отказывает без токена: клиент service_role нельзя получить, не предъявив ссылку', () => {
    expect(() => createJuryMetricsClient(undefined)).toThrow(/ссылк/i);
    expect(() => createJuryMetricsClient('')).toThrow(/ссылк/i);
  });

  it('отказывает на мусорном и подделанном токене', () => {
    expect(() => createJuryMetricsClient('not-a-token')).toThrow(/ссылк/i);
    const forged = `${validToken().slice(0, -3)}abc`;
    expect(() => createJuryMetricsClient(forged)).toThrow(/ссылк/i);
  });

  it('отказывает на токене другого скоупа: ссылка на другой экран не открывает метрики', () => {
    const otherScope = createSignedLink('some_other_scope', {}, 3600);
    expect(() => createJuryMetricsClient(otherScope)).toThrow(/ссылк/i);
  });

  it('отказывает на просроченном токене', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-09T00:00:00Z'));
      const token = createSignedLink(JURY_SCOPE, {}, 1);
      vi.advanceTimersByTime(2000);
      expect(() => createJuryMetricsClient(token)).toThrow(/ссылк/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('с валидным токеном возвращает клиент', () => {
    expect(createJuryMetricsClient(validToken())).toBeDefined();
  });

  it('с валидным токеном, но без ключа service_role — отказ, а не тихий клиент без прав', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect(() => createJuryMetricsClient(validToken())).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('сообщение отказа не раскрывает ни токен, ни ключ', () => {
    const token = validToken();
    for (const bad of [undefined, `${token}x`]) {
      // Ошибку берём явно: expect.unreachable внутри try перехватывался бы catch,
      // и проверка проходила бы, даже если фабрика ничего не бросила.
      let thrown: Error | undefined;
      try {
        createJuryMetricsClient(bad);
      } catch (error) {
        thrown = error as Error;
      }
      expect(thrown).toBeDefined();
      expect(thrown?.message).not.toContain(token);
      expect(thrown?.message).not.toContain('service-role-key-for-unit-tests');
    }
  });
});
