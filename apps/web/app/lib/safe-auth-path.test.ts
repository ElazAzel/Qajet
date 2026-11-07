import { describe, expect, it } from 'vitest';
import { safeAuthPath } from './safe-auth-path';

describe('Auth navigation stays on the application origin', () => {
  it.each([
    '/auth/set-password',
    '/auth/recover?mode=reset',
    '/buyer?tab=orders#recent',
    '/supplier',
    '/buyer?next=%2Forders',
    '/auth/recover?email=e2e%2Btest%40example.invalid',
  ])('preserves a valid internal destination: %s', (path) => {
    expect(safeAuthPath(path)).toBe(path);
  });

  it('rejects every C0 control character and DEL', () => {
    for (const code of [...Array.from({ length: 32 }, (_, index) => index), 127]) {
      expect(safeAuthPath(`/auth/${String.fromCharCode(code)}recover`)).toBe('/');
    }
  });

  it.each([
    null,
    undefined,
    7,
    '',
    'https://outside.invalid/auth/recover',
    '//outside.invalid/auth/recover',
    '/\\outside.invalid/auth/recover',
    '/\n/outside.invalid/auth/recover',
    '/\t/outside.invalid/auth/recover',
    '/\r/outside.invalid/auth/recover',
    '/auth/\u0000recover',
  ])('rejects malformed or off-origin destinations: %j', (path) => {
    expect(safeAuthPath(path, '/auth/set-password')).toBe('/auth/set-password');
  });

  it.each([
    '/\\outside.invalid/auth/recover',
    '/\n/outside.invalid/auth/recover',
    '/\t/outside.invalid/auth/recover',
    '/\r/outside.invalid/auth/recover',
  ])('remains same-origin after browser URL normalization: %j', (path) => {
    const origin = 'http://localhost:3000';
    expect(new URL(safeAuthPath(path), origin).origin).toBe(origin);
  });
});
