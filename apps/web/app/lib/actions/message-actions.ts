'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireCurrentUser } from '../current-user';
import type { ActionResult } from './request-actions';

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
  revalidatePath('/concierge');
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
  redirect(`/buyer/messages?thread=${threadId}`);
}
