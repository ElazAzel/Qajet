'use client';

import { useActionState, useEffect, useRef } from 'react';
import { sendMessageFormAction } from '../../lib/actions/message-actions';

/**
 * Отправка сообщения обычной формой с server action: Next сам делает
 * ревалидацию и перерисовку серверного компонента, поэтому отправленное
 * сообщение появляется в треде сразу. Ручной `router.refresh()` этого не
 * давал — проверено вживую, сообщение доходило до базы, но экран
 * обновлялся только после полной перезагрузки.
 */
export function MessageComposer({
  threadId,
  returnPath = `/buyer/messages?thread=${threadId}`,
}: {
  threadId: string;
  returnPath?: string;
}) {
  const [state, formAction, pending] = useActionState(sendMessageFormAction, { ok: true });
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="border-rule border-t px-6 py-4">
      <input type="hidden" name="threadId" value={threadId} />
      <input type="hidden" name="returnPath" value={returnPath} />
      <div className="flex items-center gap-3">
        <input
          type="text"
          name="body"
          required
          autoComplete="off"
          placeholder="Напишите сообщение…"
          aria-label="Текст сообщения"
          className="flex-1 rounded-control bg-page px-4 py-3 text-sm placeholder:text-muted"
        />
        <button
          type="submit"
          disabled={pending}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-purple text-white disabled:opacity-40"
          aria-label="Отправить"
        >
          →
        </button>
      </div>
      {state.error && <p className="mt-2 text-fine text-danger">{state.error}</p>}
    </form>
  );
}
