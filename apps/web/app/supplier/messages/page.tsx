import { cn } from '@qajet/ui/lib/cn';
import { Reveal } from '@qajet/ui/motion';
import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { AttachmentForm } from '../../buyer/messages/_attachment-form';
import { MessageComposer } from '../../buyer/messages/_composer';
import { loadThreadAttachments, loadThreadMessages } from '../../lib/buyer-messages';
import { requireCurrentUser } from '../../lib/current-user';
import { formatDate } from '../../lib/dates';
import { MarkThreadRead, MessageBubble } from '../../lib/message-ui';
import { loadSupplierThreads } from '../../lib/supplier-messages';

/**
 * Рабочее место переписки поставщика — тот же supplier-thread, который
 * видит консьерж, но с RLS-изоляцией конкретной компании. Здесь нет
 * buyer-thread: поставщик общается с QAJET по своему заказу и не получает
 * переписку другого исполнителя.
 */
export default async function SupplierMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string }>;
}) {
  const user = await requireCurrentUser();
  const { thread: threadParam } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const threads = await loadSupplierThreads(supabase, user.id);
  const active = threads.find((thread) => thread.id === threadParam) ?? threads[0];
  const messages = active ? await loadThreadMessages(supabase, active.id, user.id) : [];
  const attachments = active ? await loadThreadAttachments(supabase, active.id) : [];

  if (threads.length === 0) {
    return (
      <Reveal>
        <h1 className="mb-5 text-3xl font-extrabold text-ink">Сообщения</h1>
        <div className="rounded-card border border-rule bg-surface p-8 text-center">
          <p className="text-sm font-semibold text-ink">Переписок пока нет</p>
          <p className="mx-auto mt-2 max-w-sm text-fine text-muted">
            Переписка появится после назначения заказа поставщику.
          </p>
        </div>
      </Reveal>
    );
  }

  return (
    <Reveal>
      <h1 className="mb-5 text-3xl font-extrabold text-ink">Сообщения</h1>
      <div className="grid min-h-[520px] grid-cols-1 overflow-hidden rounded-card border border-rule bg-surface lg:grid-cols-[320px_1fr]">
        <div className="hidden flex-col border-rule border-r lg:flex">
          <ul className="flex-1 overflow-y-auto">
            {threads.map((thread) => (
              <li key={thread.id}>
                <Link
                  href={`/supplier/messages?thread=${thread.id}`}
                  className={cn(
                    'flex w-full items-start gap-3 border-rule border-b px-4 py-3.5 text-left',
                    thread.id === active?.id ? 'bg-page' : 'hover:bg-page/60',
                  )}
                >
                  <span className="h-10 w-10 shrink-0 rounded-control bg-page" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-ink">
                        {thread.orderTitle}
                      </span>
                      {thread.lastAt && (
                        <span className="shrink-0 text-micro text-muted">
                          {formatDate(thread.lastAt)}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-fine text-muted">QAJET</span>
                    <span className="mt-0.5 block truncate text-fine text-muted">
                      {thread.lastMessage}
                    </span>
                    {thread.unreadCount > 0 && (
                      <span className="mt-1 inline-flex rounded-full bg-purple px-1.5 py-0.5 text-micro font-semibold text-white">
                        {thread.unreadCount} новых
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-3 border-rule border-b px-6 py-4">
            <span className="h-10 w-10 shrink-0 rounded-control bg-page" aria-hidden="true" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{active?.orderTitle}</p>
              <p className="text-fine text-muted">QAJET</p>
            </div>
            {active?.orderId && (
              <Link
                href={`/supplier/orders/${active.orderId}`}
                className="ml-auto shrink-0 whitespace-nowrap text-fine font-semibold text-purple"
              >
                Открыть заказ →
              </Link>
            )}
          </div>

          <div className="flex min-h-64 flex-1 flex-col gap-3.5 overflow-y-auto p-6">
            {active && <MarkThreadRead threadId={active.id} />}
            {messages.length === 0 ? (
              <p className="m-auto text-fine text-muted">Сообщений пока нет — напишите первым.</p>
            ) : (
              messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  returnPath={`/supplier/messages?thread=${active?.id ?? ''}`}
                />
              ))
            )}
          </div>

          {active && (
            <MessageComposer
              threadId={active.id}
              returnPath={`/supplier/messages?thread=${active.id}`}
            />
          )}
          {active && attachments.length > 0 && (
            <div className="border-rule border-t px-6 py-3">
              <p className="text-micro font-semibold text-muted uppercase">Вложения</p>
              <ul className="mt-2 flex flex-col gap-1">
                {attachments.map((attachment) => (
                  <li key={attachment.id}>
                    <a
                      href={`/api/attachments/${attachment.id}/download`}
                      className="text-fine font-semibold text-purple hover:underline"
                    >
                      {attachment.fileName}
                    </a>
                    <span className="ml-2 text-micro text-muted">
                      {formatBytes(attachment.sizeBytes)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {active && (
            <AttachmentForm
              threadId={active.id}
              returnPath={`/supplier/messages?thread=${active.id}`}
            />
          )}
        </div>
      </div>
    </Reveal>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}
