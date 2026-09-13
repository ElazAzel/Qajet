'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { orderActorFor, requireCurrentUser } from '../current-user';
import {
  ALLOWED_ATTACHMENT_TYPES,
  createAttachmentObjectKey,
  MAX_ATTACHMENT_BYTES,
  SupabaseStorageAdapter,
} from '../storage/adapter';
import type { ActionResult } from './request-actions';

const uuid = z.string().uuid();
const ATTACHMENT_KINDS = new Set([
  'attachment',
  'quote_file',
  'prepay_proof',
  'delivery_proof',
  'supplier_invoice',
  'spec',
]);
const contextSchema = z
  .object({
    requestId: uuid.optional(),
    orderId: uuid.optional(),
    threadId: uuid.optional(),
    messageId: uuid.optional(),
  })
  .strict();

type AttachmentContext = z.infer<typeof contextSchema>;

function getContext(formData: FormData): AttachmentContext | string {
  const raw = {
    requestId: String(formData.get('requestId') ?? '').trim() || undefined,
    orderId: String(formData.get('orderId') ?? '').trim() || undefined,
    threadId: String(formData.get('threadId') ?? '').trim() || undefined,
    messageId: String(formData.get('messageId') ?? '').trim() || undefined,
  };
  const parsed = contextSchema.safeParse(raw);
  if (!parsed.success) return 'Контекст файла указан некорректно';
  if (Object.values(parsed.data).filter(Boolean).length !== 1) {
    return 'Файл должен быть связан ровно с одним объектом';
  }
  return parsed.data;
}

async function canUpload(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  actor: ReturnType<typeof orderActorFor>,
  userId: string,
  context: AttachmentContext,
): Promise<boolean> {
  if (actor === 'admin' || actor === 'concierge') return true;
  if (actor === 'buyer') {
    if (context.requestId) {
      const { data } = await supabase
        .from('requests')
        .select('id')
        .eq('id', context.requestId)
        .maybeSingle();
      return Boolean(data);
    }
    if (context.orderId) {
      const { data } = await supabase
        .from('orders')
        .select('id')
        .eq('id', context.orderId)
        .maybeSingle();
      return Boolean(data);
    }
    if (context.threadId) {
      const { data } = await supabase
        .from('threads')
        .select('id')
        .eq('id', context.threadId)
        .eq('kind', 'buyer')
        .maybeSingle();
      return Boolean(data);
    }
    const { data } = await supabase
      .from('messages')
      .select('id')
      .eq('id', context.messageId ?? '')
      .maybeSingle();
    return Boolean(data);
  }

  if (actor === 'supplier') {
    if (context.threadId) {
      const { data } = await supabase
        .from('threads')
        .select('id')
        .eq('id', context.threadId)
        .eq('kind', 'supplier')
        .maybeSingle();
      return Boolean(data);
    }
    if (context.messageId) {
      const { data } = await supabase
        .from('messages')
        .select('id, threads!inner(kind)')
        .eq('id', context.messageId)
        .eq('threads.kind', 'supplier')
        .maybeSingle();
      return Boolean(data);
    }
    if (context.orderId) {
      const { data } = await supabase
        .from('plan_lines')
        .select('id, orders!inner(id)')
        .eq('orders.id', context.orderId)
        .maybeSingle();
      return Boolean(data);
    }
  }

  void userId;
  return false;
}

async function storageForUpload(): Promise<SupabaseStorageAdapter> {
  try {
    return new SupabaseStorageAdapter(createSupabaseAdminClient());
  } catch {
    return new SupabaseStorageAdapter(await createSupabaseServerClient());
  }
}

export async function uploadAttachment(
  formData: FormData,
): Promise<ActionResult & { id?: string }> {
  const user = await requireCurrentUser();
  const context = getContext(formData);
  if (typeof context === 'string') return { ok: false, error: context };
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Выберите файл' };
  if (file.size > MAX_ATTACHMENT_BYTES) return { ok: false, error: 'Файл больше 10 МБ' };
  if (!ALLOWED_ATTACHMENT_TYPES.has(file.type)) {
    return { ok: false, error: 'Этот тип файла не поддерживается' };
  }
  if (file.name.length > 200) return { ok: false, error: 'Имя файла слишком длинное' };
  const kind = String(formData.get('kind') ?? 'attachment').trim();
  if (!ATTACHMENT_KINDS.has(kind)) return { ok: false, error: 'Тип вложения указан некорректно' };

  const supabase = await createSupabaseServerClient();
  const actor = orderActorFor(user);
  const allowedKinds =
    actor === 'buyer'
      ? new Set(['attachment', 'spec', 'prepay_proof'])
      : actor === 'supplier'
        ? new Set(['attachment', 'quote_file', 'delivery_proof', 'supplier_invoice'])
        : ATTACHMENT_KINDS;
  if (!allowedKinds.has(kind)) {
    return { ok: false, error: 'Этот тип вложения недоступен для вашей роли' };
  }
  if (!(await canUpload(supabase, actor, user.id, context))) {
    return { ok: false, error: 'У вас нет доступа к этому контексту' };
  }

  const objectKey = createAttachmentObjectKey(user.id, file.name);
  const storage = await storageForUpload();
  try {
    await storage.put(objectKey, file, file.type);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Не удалось загрузить файл',
    };
  }

  const { data, error } = await supabase
    .from('attachments')
    .insert({
      ...Object.fromEntries(
        Object.entries(context).map(([key, value]) => [
          key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
          value,
        ]),
      ),
      uploaded_by: user.id,
      object_key: objectKey,
      file_name: file.name,
      content_type: file.type,
      size_bytes: file.size,
      kind,
    })
    .select('id')
    .single();
  if (error || !data) {
    await storage.delete(objectKey).catch(() => undefined);
    return { ok: false, error: error?.message ?? 'Не удалось сохранить файл' };
  }

  revalidatePath('/buyer/messages');
  revalidatePath('/supplier');
  revalidatePath('/concierge');
  return { ok: true, id: data.id };
}

export async function uploadAttachmentFormAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const result = await uploadAttachment(formData);
  if (!result.ok) return result;
  const threadId = String(formData.get('threadId') ?? '').trim();
  const requestedPath = String(formData.get('returnPath') ?? '').trim();
  const returnPath =
    requestedPath === '/buyer' ||
    requestedPath.startsWith('/buyer/messages') ||
    requestedPath.startsWith('/supplier/messages') ||
    (requestedPath.startsWith('/concierge/orders/') && requestedPath.includes('/messages'))
      ? requestedPath
      : threadId
        ? `/buyer/messages?thread=${threadId}`
        : '/buyer/messages';
  redirect(returnPath);
}
