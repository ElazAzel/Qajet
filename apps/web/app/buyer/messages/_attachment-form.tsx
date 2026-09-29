'use client';

import { type FormEvent, useRef, useState, useTransition } from 'react';
import {
  finishAttachmentUpload,
  prepareAttachmentUpload,
} from '../../lib/actions/attachment-actions';

/** Как MAX_ATTACHMENT_BYTES на сервере (app/lib/storage/adapter.ts). */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** Как STORAGE_BUCKET на сервере. */
const STORAGE_BUCKET = 'qajet-docs';

type AttachmentKind =
  | 'attachment'
  | 'spec'
  | 'quote_file'
  | 'prepay_proof'
  | 'delivery_proof'
  | 'supplier_invoice';

/**
 * Файл уходит из браузера прямо в Storage по разовому праву, выданному
 * сервером, а не через Server Action: Vercel отрезает тело запроса к функции
 * на ~4,5 МБ (413 FUNCTION_PAYLOAD_TOO_LARGE), и вложения 4,5–10 МБ в
 * production не загружались вовсе. Сервер проверяет всё до загрузки и
 * сверяет реальный объект после неё.
 */
async function putToStorage(path: string, token: string, file: File): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return false;
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.storage
    .from(STORAGE_BUCKET)
    .uploadToSignedUrl(path, token, file, { contentType: file.type });
  return !error;
}

export function AttachmentForm({
  threadId,
  requestId,
  orderId,
  returnPath,
  kind = 'attachment',
}: {
  threadId?: string;
  requestId?: string;
  orderId?: string;
  returnPath?: string;
  kind?: AttachmentKind;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const contextCount = [threadId, requestId, orderId].filter(Boolean).length;
  const fallbackPath = threadId ? `/buyer/messages?thread=${threadId}` : '/buyer';

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = new FormData(event.currentTarget).get('file');
    if (!(file instanceof File) || file.size === 0) {
      setError('Выберите файл');
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setError('Файл больше 10 МБ');
      return;
    }
    setError(null);
    startTransition(async () => {
      const prepared = await prepareAttachmentUpload({
        threadId,
        requestId,
        orderId,
        kind,
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });
      if (!prepared.ok || !prepared.upload) {
        setError(prepared.error ?? 'Не удалось начать загрузку');
        return;
      }
      const uploaded = await putToStorage(prepared.upload.path, prepared.upload.token, file);
      if (!uploaded) {
        setError('Файл не загрузился — проверьте соединение и попробуйте ещё раз');
        return;
      }
      // При успехе сервер делает redirect, и форма уходит вместе со страницей.
      const finished = await finishAttachmentUpload(
        prepared.upload.intent,
        returnPath ?? fallbackPath,
      );
      if (finished && !finished.ok) setError(finished.error ?? 'Не удалось сохранить файл');
      else formRef.current?.reset();
    });
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="border-rule border-t px-6 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="min-w-0 flex-1 text-micro text-muted">
          <span className="sr-only">Прикрепить файл</span>
          <input
            type="file"
            name="file"
            required
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file && file.size > MAX_ATTACHMENT_BYTES) {
                setError('Файл больше 10 МБ');
                event.currentTarget.value = '';
              } else {
                setError(null);
              }
            }}
            accept="application/pdf,image/jpeg,image/png,image/webp,text/plain,.docx,.xlsx"
            className="block w-full text-micro text-muted file:mr-2 file:rounded-control file:border-0 file:bg-page file:px-3 file:py-2 file:text-micro file:font-semibold file:text-ink"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-control border border-rule px-3 py-2 text-fine font-semibold text-ink disabled:opacity-50"
        >
          {pending ? 'Загружаю…' : 'Прикрепить'}
        </button>
      </div>
      {contextCount !== 1 && (
        <p className="mt-1 text-fine text-danger">Не удалось определить объект для вложения</p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-fine text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
