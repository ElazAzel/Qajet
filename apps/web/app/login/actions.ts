'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { parseProgramBrief, programRequestUrl } from '../lib/program-brief';

/** Куда вести после входа — по роли и типу компании (agents.md §3). */
async function redirectPathFor(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
): Promise<'/buyer' | '/supplier' | '/concierge' | '/admin' | null> {
  const { data: profile } = await supabase
    .from('users')
    .select('role, is_active, companies(type)')
    .eq('id', userId)
    .single();

  if (!profile?.is_active) return null;
  if (profile?.role === 'concierge') return '/concierge';
  if (profile?.role === 'admin') return '/admin';

  const companyType = (profile?.companies as { type?: string } | null)?.type;
  return companyType === 'supplier' ? '/supplier' : companyType === 'buyer' ? '/buyer' : null;
}

export async function signIn(
  _prevState: string | null,
  formData: FormData,
): Promise<string | null> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return 'Введите почту и пароль.';
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return 'Неверная почта или пароль.';
  }

  const path = await redirectPathFor(supabase, data.user.id);
  if (!path) {
    await supabase.auth.signOut();
    return 'Профиль недоступен. Обратитесь к администратору QAJET.';
  }
  const brief = parseProgramBrief(formData.get('brief'));
  redirect(path === '/buyer' && brief ? programRequestUrl() : path);
}

/**
 * Быстрый вход демо-аккаунтами — только в dev, agents.md §13.
 * Без возврата ошибки в UI: это служебная кнопка разработки, а не форма
 * с обратной связью — на неудаче просто не редиректит.
 */
export async function quickSignIn(email: string): Promise<void> {
  if (process.env.NODE_ENV === 'production') return;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: 'qajet2026' });

  if (error || !data.user) return;

  const path = await redirectPathFor(supabase, data.user.id);
  if (!path) {
    await supabase.auth.signOut();
    return;
  }
  redirect(path);
}
