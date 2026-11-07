import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ exchange: vi.fn(), verify: vi.fn(), create: vi.fn() }));
vi.mock('@supabase/ssr', () => ({ createServerClient: auth.create }));

import { GET } from './route';

const origin = 'http://localhost:3000';
const syntheticToken = 'E2E-local-onboarding-token';

function request(params: Record<string, string>) {
  const url = new URL('/auth/confirm', origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new NextRequest(url);
}

describe('invitation callback with a local mocked Auth provider', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('Unexpected network request');
      }),
    );
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'E2E-local-onboarding-not-a-key');
    auth.exchange.mockResolvedValue({ error: null });
    auth.verify.mockResolvedValue({ error: null });
    auth.create.mockReturnValue({
      auth: { exchangeCodeForSession: auth.exchange, verifyOtp: auth.verify },
    });
  });

  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('accepts an invite token and redirects to password setup without forwarding the token', async () => {
    const response = await GET(request({ token_hash: syntheticToken, type: 'invite' }));
    expect(auth.verify).toHaveBeenCalledExactlyOnceWith({
      token_hash: syntheticToken,
      type: 'invite',
    });
    expect(auth.exchange).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe(`${origin}/auth/set-password`);
  });

  it('prioritizes a PKCE code and writes provider cookies into the redirect response', async () => {
    const req = request({ code: syntheticToken, token_hash: 'ignored', type: 'invite' });
    auth.exchange.mockImplementation(async () => {
      const options = auth.create.mock.calls[0]?.[2];
      options.cookies.setAll([
        {
          name: 'E2E-session',
          value: 'synthetic',
          options: { httpOnly: true, sameSite: 'lax', path: '/' },
        },
      ]);
      return { error: null };
    });
    const response = await GET(req);
    expect(auth.exchange).toHaveBeenCalledExactlyOnceWith(syntheticToken);
    expect(auth.verify).not.toHaveBeenCalled();
    expect(response.cookies.get('E2E-session')?.value).toBe('synthetic');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(req.cookies.get('E2E-session')?.value).toBe('synthetic');
  });

  it('keeps the internal recovery destination', async () => {
    const response = await GET(
      request({ token_hash: syntheticToken, type: 'recovery', next: '/auth/recover?mode=reset' }),
    );
    expect(response.headers.get('location')).toBe(`${origin}/auth/recover?mode=reset`);
  });

  it.each([
    'https://outside.invalid/auth/recover',
    '//outside.invalid/auth/recover',
    '/\\outside.invalid/auth/recover',
    '/\n/outside.invalid/auth/recover',
    '/\t/outside.invalid/auth/recover',
    '/\r/outside.invalid/auth/recover',
  ])('never redirects an invitation to an external origin: %j', async (next) => {
    const response = await GET(request({ token_hash: syntheticToken, type: 'invite', next }));
    expect(response.headers.get('location')).toBe(`${origin}/auth/set-password`);
  });

  it('returns a safe login destination for a missing token', async () => {
    const response = await GET(request({ type: 'invite' }));
    expect(response.headers.get('location')).toBe(`${origin}/login?auth_error=1`);
    expect(auth.exchange).not.toHaveBeenCalled();
    expect(auth.verify).not.toHaveBeenCalled();
  });

  it.each(['invite', 'code'])(
    'handles an Auth provider error for %s without leaking provider detail',
    async (mode) => {
      auth.exchange.mockResolvedValue({ error: new Error('E2E-private-provider-detail') });
      auth.verify.mockResolvedValue({ error: new Error('E2E-private-provider-detail') });
      const params =
        mode === 'code' ? { code: syntheticToken } : { token_hash: syntheticToken, type: 'invite' };
      const response = await GET(request(params));
      expect(response.headers.get('location')).toBe(`${origin}/login?auth_error=1`);
    },
  );
});
