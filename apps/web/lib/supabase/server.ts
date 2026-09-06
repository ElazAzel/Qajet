import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Клиент Supabase для серверного кода (Server Actions, Server Components).
 * Работает под RLS текущего пользователя через cookie-сессию — никогда
 * под service_role. Единственная точка, где приложение говорит с Supabase
 * Auth (agents.md §11.1: доступ к персональным данным не размазан по коду).
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        },
      },
    },
  );
}
