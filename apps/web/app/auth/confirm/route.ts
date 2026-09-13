import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import { safeAuthPath } from '../../lib/safe-auth-path';

const OTP_TYPES = new Set([
  'email',
  'invite',
  'recovery',
  'signup',
  'email_change',
  'phone_change',
] as const);

/** Supabase Auth callback for invite, email confirmation and recovery links. */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const next = safeAuthPath(url.searchParams.get('next'), '/');
  const typeParam = url.searchParams.get('type');
  const type = OTP_TYPES.has(typeParam as never) ? (typeParam as never) : 'recovery';
  const destination =
    next === '/'
      ? '/auth/set-password'
      : next.includes('/auth/recover')
        ? next
        : '/auth/set-password';
  const response = NextResponse.redirect(new URL(destination, request.url));
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  let error: Error | null = null;
  const code = url.searchParams.get('code');
  if (code) {
    const result = await supabase.auth.exchangeCodeForSession(code);
    error = result.error;
  } else {
    const tokenHash = url.searchParams.get('token_hash');
    if (!tokenHash) error = new Error('Auth callback token is missing');
    else {
      const result = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      error = result.error;
    }
  }

  if (error) {
    const failure = new URL('/login', request.url);
    failure.searchParams.set('auth_error', '1');
    return NextResponse.redirect(failure);
  }

  return response;
}
