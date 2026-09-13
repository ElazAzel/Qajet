'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireCurrentUser } from '../current-user';
import type { ActionResult } from './request-actions';

function safeMessageReturnPath(value: unknown): string {
  if (typeof value !== 'string') return '/buyer/messages';
  if (
    value.startsWith('/buyer/messages') ||
    value.startsWith('/supplier/messages') ||
    (value.startsWith('/concierge/orders/') && value.includes('/messages'))
  ) {
    return value;
  }
  return '/buyer/messages';
}

/**
 * Отправка сообщения в тред — agents.md §5. Роль здесь не проверяется
 * намеренно: писать в тред может любой, кому он виден, а видимость уже
 * решает RLS (`messages_insert_via_thread`: тред обязан быть видим И автор
 * обязан совпадать с текущим пользователем). Дублировать это условие в
 * коде значило бы держать две копии правила, которые разойдутся.
 *
 * Внутренние заметки (`kind='internal'`) покупателю не видны вовсе, так
 * что и написать в них он не сможет — отказ придёт от Postgres, а не от
 * проверки в приложении.
 */
export async function sendMessage(threadId: string, body: string): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const text = body.trim();
  if (!text) return { ok: false, error: 'Сообщение пустое' };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('messages')
    .insert({ thread_id: threadId, author_user_id: user.id, body: text });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/buyer/messages');
  revalidatePath('/supplier/messages');
  revalidatePath('/concierge', 'layout');
  return { ok: true };
}

/** Отметка последнего просмотренного сообщения — не флаг на каждом сообщении. */
export async function markThreadRead(threadId: string): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('thread_reads').upsert(
    {
      thread_id: threadId,
      user_id: user.id,
      last_read_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'thread_id,user_id' },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Автор может поправить только собственный текст; это также продублировано RLS. */
export async function editMessage(
  messageId: string,
  body: string,
  returnPath = '/buyer/messages',
): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const text = body.trim();
  if (!text) return { ok: false, error: 'Сообщение пустое' };
  if (text.length > 10_000) return { ok: false, error: 'Сообщение слишком длинное' };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('messages')
    .update({ body: text, updated_at: new Date().toISOString() })
    .eq('id', messageId)
    .eq('author_user_id', user.id)
    .select('id')
    .maybeSingle();
  if (error || !data) return { ok: false, error: error?.message ?? 'Сообщение не найдено' };

  revalidatePath('/buyer/messages');
  revalidatePath('/supplier/messages');
  revalidatePath('/concierge', 'layout');
  const safePath = safeMessageReturnPath(returnPath);
  revalidatePath(safePath.split('?')[0] ?? safePath);
  return { ok: true };
}

/**
 * Тот же вызов, но формой — `<form action={...}>` вместо ручного
 * `router.refresh()` после клика. Проверено вживую: сообщение доходило до
 * базы и раньше, но refresh не перерисовывал серверный компонент, и
 * отправленное появлялось только после полной перезагрузки. Форма отдаёт
 * ревалидацию и перерисовку самому Next одним раундтрипом, а заодно
 * работает без JS.
 */
export async function sendMessageFormAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const threadId = String(formData.get('threadId') ?? '');
  const result = await sendMessage(threadId, String(formData.get('body') ?? ''));
  if (!result.ok) return result;
  // Именно redirect, а не только revalidatePath: проверено вживую — после
  // действия Next не перезапрашивал маршрут, сообщение доходило до базы, но
  // появлялось в треде только после полной перезагрузки страницы. Redirect
  // на тот же адрес форсирует настоящую навигацию и перерисовку.
  redirect(safeMessageReturnPath(formData.get('returnPath')));
}
