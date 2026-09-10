import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignedLink, verifySignedLink } from './signed-link';

describe('signed-link', () => {
  const originalSecret = process.env.LINK_SIGNING_SECRET;

  beforeEach(() => {
    process.env.LINK_SIGNING_SECRET = 'test-secret-for-signed-link-unit-tests';
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    if (originalSecret === undefined) delete process.env.LINK_SIGNING_SECRET;
    else process.env.LINK_SIGNING_SECRET = originalSecret;
  });

  it('не использует публичный dev-секрет в production', () => {
    delete process.env.LINK_SIGNING_SECRET;
    const token = createSignedLink('metrics_jury', {}, 3600);
    vi.stubEnv('NODE_ENV', 'production');
    expect(verifySignedLink(token, 'metrics_jury')).toBeNull();
    expect(() => createSignedLink('metrics_jury', {}, 3600)).toThrow('LINK_SIGNING_SECRET');
  });

  it('ссылка истекает ровно в exp, а не через секунду', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-09T00:00:00Z'));
    const token = createSignedLink('metrics_jury', {}, 1);
    vi.advanceTimersByTime(1000);
    expect(verifySignedLink(token, 'metrics_jury')).toBeNull();
  });

  it.each([
    null,
    [],
    { scope: 'metrics_jury', payload: {} },
    { scope: 'metrics_jury', payload: {}, exp: '9999999999' },
    { scope: 'metrics_jury', exp: 9999999999 },
  ])('отклоняет некорректную подписанную структуру: %j', (body) => {
    const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
    const sig = createHmac('sha256', process.env.LINK_SIGNING_SECRET as string)
      .update(encoded)
      .digest('base64url');
    expect(verifySignedLink(`${encoded}.${sig}`, 'metrics_jury')).toBeNull();
  });

  it('создаёт токен, который проходит проверку с тем же скоупом', () => {
    const token = createSignedLink('metrics_jury', { note: 'demo' }, 3600);
    expect(verifySignedLink<{ note: string }>(token, 'metrics_jury')).toEqual({ note: 'demo' });
  });

  it('отклоняет токен с неверным скоупом', () => {
    const token = createSignedLink('metrics_jury', {}, 3600);
    expect(verifySignedLink(token, 'rfq_respond')).toBeNull();
  });

  it('отклоняет просроченный токен', () => {
    const token = createSignedLink('metrics_jury', {}, -1);
    expect(verifySignedLink(token, 'metrics_jury')).toBeNull();
  });

  it('отклоняет токен с подделанной подписью', () => {
    const token = createSignedLink('metrics_jury', { id: 'real' }, 3600);
    const [body] = token.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({ scope: 'metrics_jury', payload: { id: 'forged' }, exp: 9999999999 }),
      'utf8',
    ).toString('base64url');
    const forged = `${forgedPayload}.${token.split('.')[1]}`;
    expect(body).not.toBe(forgedPayload);
    expect(verifySignedLink(forged, 'metrics_jury')).toBeNull();
  });

  it('отклоняет токен, подписанный другим секретом', () => {
    const token = createSignedLink('metrics_jury', {}, 3600);
    process.env.LINK_SIGNING_SECRET = 'a-completely-different-secret';
    expect(verifySignedLink(token, 'metrics_jury')).toBeNull();
  });

  it('отклоняет мусор вместо токена', () => {
    expect(verifySignedLink('', 'metrics_jury')).toBeNull();
    expect(verifySignedLink('not-a-token', 'metrics_jury')).toBeNull();
    expect(verifySignedLink('a.b.c', 'metrics_jury')).toBeNull();
  });
});
