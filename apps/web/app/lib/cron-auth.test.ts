import { describe, expect, it } from 'vitest';
import { isCronAuthorized } from './cron-auth';

const request = (authorization?: string) =>
  new Request('https://example.test/api/jobs/outbox', {
    headers: authorization ? { authorization } : {},
  });

describe('isCronAuthorized', () => {
  it('закрыто, когда секрет не задан — в любом окружении', () => {
    expect(isCronAuthorized(request('Bearer anything'), undefined)).toBe(false);
    expect(isCronAuthorized(request(), '')).toBe(false);
    expect(isCronAuthorized(request('Bearer '), '   ')).toBe(false);
  });

  it('пропускает только точный Bearer-секрет', () => {
    expect(isCronAuthorized(request('Bearer s3cret'), 's3cret')).toBe(true);
    expect(isCronAuthorized(request('Bearer s3cre'), 's3cret')).toBe(false);
    expect(isCronAuthorized(request('bearer s3cret'), 's3cret')).toBe(false);
    expect(isCronAuthorized(request('Bearer other!'), 's3cret')).toBe(false);
    expect(isCronAuthorized(request(), 's3cret')).toBe(false);
  });
});
