'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { actionFailure } from '../action-result';
import { orderActorFor, requireCurrentUser } from '../current-user';
import { createSignedLink, verifySignedLink } from '../signed-link';
import {
  ALLOWED_ATTACHMENT_TYPES,
  createAttachmentObjectKey,
  MAX_ATTACHMENT_BYTES,
  SupabaseStorageAdapter,
  type UploadGrant,
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

function getContext(input: {
  requestId?: string | undefined;
  orderId?: string | undefined;
  threadId?: string | undefined;
  messageId?: string | undefined;
}): AttachmentContext | string {
  const raw = {
    requestId: input.requestId?.trim() || undefined,
    orderId: input.orderId?.trim() || undefined,
    threadId: input.threadId?.trim() || undefined,
    messageId: input.messageId?.trim() || undefined,
  };
  const parsed = contextSchema.safeParse(raw);
  if (!parsed.success) return 'Контекст файла указан некорректно';
  if (Object.values(parsed.data).filter(Boolean).length !== 1) {
    return 'Файл должен быть связан ровно с одним объектом';
  }
  return parsed.data;
}

function allowedKindsFor(actor: ReturnType<typeof orderActorFor>): Set<string> {
  if (actor === 'buyer') return new Set(['attachment', 'spec', 'prepay_proof']);
  if (actor === 'supplier') {
    return new Set(['attachment', 'quote_file', 'delivery_proof', 'supplier_invoice']);
  }
  return ATTACHMENT_KINDS;
}

async function canUpload(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  actor: ReturnType<typeof orderActorFor>,
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
        .from('orders')
        .select('id')
        .eq('id', context.orderId)
        .maybeSingle();
      return Boolean(data);
    }
  }

  return false;
}

async function storageForUpload(): Promise<SupabaseStorageAdapter> {
  try {
    return new SupabaseStorageAdapter(createSupabaseAdminClient());
  } catch {
    return new SupabaseStorageAdapter(await createSupabaseServerClient());
  }
}

const UPLOAD_SCOPE = 'attachment-upload';
/** С запасом на 10 МБ по медленной мобильной сети. */
const UPLOAD_INTENT_TTL_SECONDS = 60 * 60;

/**
 * Подписанное сервером «намерение загрузки»: после того как браузер положил
 * файл в Storage, сервер доверяет только этим полям, а не тому, что пришлёт
 * клиент на втором шаге. Без таблицы и миграции — HMAC тем же примитивом,
 * что ссылки для жюри и RFQ.
 */
interface UploadIntent {
  userId: string;
  objectKey: string;
  context: AttachmentContext;
  kind: string;
  fileName: string;
}

export interface AttachmentUploadInput {
  requestId?: string | undefined;
  orderId?: string | undefined;
  threadId?: string | undefined;
  messageId?: string | undefined;
  kind?: string | undefined;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

/**
 * Шаг 1 из 2. Файл сюда не передаётся — только его имя, тип и размер. Всё,
 * что можно проверить до загрузки, проверяется здесь, чтобы не гонять 10 МБ
 * ради отказа.
 */
export async function prepareAttachmentUpload(
  input: AttachmentUploadInput,
): Promise<ActionResult & { upload?: UploadGrant & { intent: string } }> {
  const user = await requireCurrentUser();
  const context = getContext(input);
  if (typeof context === 'string') return { ok: false, error: context };
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, error: 'Выберите файл' };
  }
  if (input.sizeBytes > MAX_ATTACHMENT_BYTES) return { ok: false, error: 'Файл больше 10 МБ' };
  if (!ALLOWED_ATTACHMENT_TYPES.has(input.contentType)) {
    return { ok: false, error: 'Этот тип файла не поддерживается' };
  }
  const fileName = input.fileName.trim();
  if (!fileName) return { ok: false, error: 'Выберите файл' };
  if (fileName.length > 200) return { ok: false, error: 'Имя файла слишком длинное' };
  const kind = (input.kind ?? 'attachment').trim();
  if (!ATTACHMENT_KINDS.has(kind)) return { ok: false, error: 'Тип вложения указан некорректно' };

  const supabase = await createSupabaseServerClient();
  const actor = orderActorFor(user);
  if (!allowedKindsFor(actor).has(kind)) {
    return { ok: false, error: 'Этот тип вложения недоступен для вашей роли' };
  }
  if (!(await canUpload(supabase, actor, context))) {
    return { ok: false, error: 'У вас нет доступа к этому контексту' };
  }

  const objectKey = createAttachmentObjectKey(user.id, fileName);
  try {
    const storage = await storageForUpload();
    const grant = await storage.createUploadGrant(objectKey);
    const intent = createSignedLink<UploadIntent>(
      UPLOAD_SCOPE,
      { userId: user.id, objectKey, context, kind, fileName },
      UPLOAD_INTENT_TTL_SECONDS,
    );
    return { ok: true, upload: { ...grant, intent } };
  } catch (error) {
    return actionFailure('attachment.prepareUpload', error, 'Не удалось начать загрузку');
  }
}

function safeReturnPath(requestedPath: string, context: AttachmentContext): string {
  const path = requestedPath.trim();
  if (
    path === '/buyer' ||
    path.startsWith('/buyer/messages') ||
    path.startsWith('/supplier/messages') ||
    (path.startsWith('/concierge/orders/') && path.includes('/messages'))
  ) {
    return path;
  }
  return context.threadId ? `/buyer/messages?thread=${context.threadId}` : '/buyer/messages';
}

/**
 * Шаг 2 из 2. Строка `attachments` появляется только после того, как объект
 * реально лежит в Storage, и с тем размером и типом, которые записал Storage,
 * а не браузер. Повтор того же шага (двойной клик, повтор после обрыва сети)
 * не создаёт второй строки: `object_key` уникален.
 */
export async function finishAttachmentUpload(
  intentToken: string,
  returnPath: string,
): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const intent = verifySignedLink<UploadIntent>(intentToken, UPLOAD_SCOPE);
  if (!intent || intent.userId !== user.id || !intent.objectKey.startsWith(`${user.id}/`)) {
    return { ok: false, code: 'forbidden', error: 'Загрузка устарела — выберите файл ещё раз' };
  }

  const supabase = await createSupabaseServerClient();
  const actor = orderActorFor(user);
  if (
    !allowedKindsFor(actor).has(intent.kind) ||
    !(await canUpload(supabase, actor, intent.context))
  ) {
    return { ok: false, code: 'forbidden', error: 'У вас нет доступа к этому контексту' };
  }

  const storage = await storageForUpload();
  const stored = await storage.stat(intent.objectKey).catch(() => null);
  if (!stored) {
    return { ok: false, error: 'Файл не дошёл до хранилища — попробуйте ещё раз' };
  }
  if (
    stored.size <= 0 ||
    stored.size > MAX_ATTACHMENT_BYTES ||
    !ALLOWED_ATTACHMENT_TYPES.has(stored.contentType)
  ) {
    await storage.delete(intent.objectKey).catch(() => undefined);
    return { ok: false, error: 'Файл не прошёл проверку размера или типа' };
  }

  const { error } = await supabase.from('attachments').insert({
    ...Object.fromEntries(
      Object.entries(intent.context).map(([key, value]) => [
        key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
        value,
      ]),
    ),
    uploaded_by: user.id,
    object_key: intent.objectKey,
    file_name: intent.fileName,
    content_type: stored.contentType,
    size_bytes: stored.size,
    kind: intent.kind,
  });
  if (error && error.code !== '23505') {
    // A lost response can follow a successful insert. Retain the object so a
    // retry cannot delete an attachment already referenced by the database.
    return actionFailure('attachment.finishUpload', error, 'Не удалось сохранить файл');
  }

  revalidatePath('/buyer', 'layout');
  revalidatePath('/supplier', 'layout');
  revalidatePath('/concierge', 'layout');
  // Навигация, а не только revalidatePath: так экран гарантированно
  // перерисуется с новым вложением (см. тот же приём в message-actions.ts).
  redirect(safeReturnPath(returnPath, intent.context));
}
