import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

/** Refresh cookies before Server Components render. Authorization stays in
 * requireCurrentUser/requireActor and RLS, not in this session adapter. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, cacheHeaders) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [name, value] of Object.entries(cacheHeaders ?? {})) {
          response.headers.set(name, value);
        }
        response.headers.set('Cache-Control', 'private, no-store');
      },
    },
  });
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: [
    '/buyer/:path*',
    '/supplier/:path*',
    '/concierge/:path*',
    '/admin/:path*',
    '/auth/:path*',
    '/metrics',
    '/login',
  ],
};
