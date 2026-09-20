'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { uploadAttachmentFormAction } from '../../lib/actions/attachment-actions';

/** Как MAX_ATTACHMENT_BYTES на сервере (app/lib/storage/adapter.ts). */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

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
  kind?:
    | 'attachment'
    | 'spec'
    | 'quote_file'
    | 'prepay_proof'
    | 'delivery_proof'
    | 'supplier_invoice';
}) {
  const [state, formAction, pending] = useActionState(uploadAttachmentFormAction, { ok: true });
  const formRef = useRef<HTMLFormElement>(null);
  const [sizeError, setSizeError] = useState<string | null>(null);
  const contextCount = [threadId, requestId, orderId].filter(Boolean).length;
  const fallbackPath = threadId ? `/buyer/messages?thread=${threadId}` : '/buyer';

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="border-rule border-t px-6 py-3">
      {threadId && <input type="hidden" name="threadId" value={threadId} />}
      {requestId && <input type="hidden" name="requestId" value={requestId} />}
      {orderId && <input type="hidden" name="orderId" value={orderId} />}
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="returnPath" value={returnPath ?? fallbackPath} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="min-w-0 flex-1 text-micro text-muted">
          <span className="sr-only">Прикрепить файл</span>
          <input
            type="file"
            name="file"
            required
            onChange={(event) => {
              // Сервер принимает тело до ~11 МБ; файл больше терялся бы молча.
              // Лимит совпадает с MAX_ATTACHMENT_BYTES (server-only, сюда не импортируется).
              const file = event.currentTarget.files?.[0];
              if (file && file.size > MAX_ATTACHMENT_BYTES) {
                setSizeError('Файл больше 10 МБ');
                event.currentTarget.value = '';
              } else {
                setSizeError(null);
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
      {(sizeError ?? state.error) && (
        <p role="alert" className="mt-1 text-fine text-danger">
          {sizeError ?? state.error}
        </p>
      )}
    </form>
  );
}
