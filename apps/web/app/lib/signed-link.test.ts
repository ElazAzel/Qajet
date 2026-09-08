import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSignedLink, verifySignedLink } from './signed-link';

describe('signed-link', () => {
  const originalSecret = process.env.LINK_SIGNING_SECRET;

  beforeEach(() => {
    process.env.LINK_SIGNING_SECRET = 'test-secret-for-signed-link-unit-tests';
  });

  afterEach(() => {
    process.env.LINK_SIGNING_SECRET = originalSecret;
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
