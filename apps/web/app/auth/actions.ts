'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { safeAuthPath } from '../lib/safe-auth-path';

const MIN_PASSWORD_LENGTH = 8;

function validatePassword(password: string, confirmation: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Пароль должен содержать минимум ${MIN_PASSWORD_LENGTH} символов.`;
  }
  if (password !== confirmation) return 'Пароли не совпадают.';
  return null;
}

export async function requestPasswordReset(
  _previous: string | null,
  formData: FormData,
): Promise<string | null> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Введите корректный email.';

  const requestHeaders = await headers();
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ??
    requestHeaders.get('origin') ??
    'http://localhost:3000';
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/confirm?next=${encodeURIComponent('/auth/recover?mode=reset')}`,
  });

  // Не раскрываем существование аккаунта. Ошибка инфраструктуры всё равно
  // показывается человеку, чтобы команда могла исправить SMTP/allow-list.
  if (error) return error.message;
  return null;
}

export async function setPassword(
  _previous: string | null,
  formData: FormData,
): Promise<string | null> {
  const password = String(formData.get('password') ?? '');
  const confirmation = String(formData.get('confirmation') ?? '');
  const validationError = validatePassword(password, confirmation);
  if (validationError) return validationError;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 'Ссылка устарела. Запросите новое приглашение или восстановление пароля.';

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return error.message;

  redirect(safeAuthPath(formData.get('next'), '/'));
}

export async function finishRecovery(
  _previous: string | null,
  formData: FormData,
): Promise<string | null> {
  return setPassword(_previous, formData);
}
