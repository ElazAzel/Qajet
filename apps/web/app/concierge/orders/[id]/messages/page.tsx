import { cn } from '@qajet/ui/lib/cn';
import { Reveal } from '@qajet/ui/motion';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { AttachmentForm } from '../../../../buyer/messages/_attachment-form';
import { MessageComposer } from '../../../../buyer/messages/_composer';
import { loadThreadAttachments, loadThreadMessages } from '../../../../lib/buyer-messages';
import { orderActorFor, requireCurrentUser } from '../../../../lib/current-user';
import { MarkThreadRead, MessageBubble } from '../../../../lib/message-ui';

type Nested<T> = T | T[] | null | undefined;

interface ThreadRow {
  id: string;
  kind: 'buyer' | 'supplier' | 'internal';
  supplier_company_id: string | null;
  companies: Nested<{ name: string }>;
}

interface OrderRow {
  id: string;
  requests: Nested<{ title: string }>;
}

export default async function ConciergeOrderMessagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ thread?: string }>;
}) {
  const { id } = await params;
  const { thread: threadParam } = await searchParams;
  const user = await requireCurrentUser();
  const actor = orderActorFor(user);
  if (actor !== 'concierge' && actor !== 'admin') notFound();

  const supabase = await createSupabaseServerClient();
  const { data: order } = await supabase
    .from('orders')
    .select('id, requests(title)')
    .eq('id', id)
    .maybeSingle<OrderRow>();
  if (!order) notFound();

  const { data: threadRows } = await supabase
    .from('threads')
    .select('id, kind, supplier_company_id, companies(name)')
    .eq('order_id', order.id)
    .order('kind', { ascending: true });
  const threads = (threadRows ?? []) as unknown as ThreadRow[];
  const active = threads.find((thread) => thread.id === threadParam) ?? threads[0];
  const messages = active ? await loadThreadMessages(supabase, active.id, user.id) : [];
  const attachments = active ? await loadThreadAttachments(supabase, active.id) : [];

  return (
    <Reveal>
      <p className="text-fine text-muted">
        <Link href={`/concierge/orders/${order.id}`} className="hover:text-ink">
          Заказ
        </Link>
        <span className="mx-1.5">›</span>
        Переписка
      </p>
      <h1 className="mt-2 text-2xl font-extrabold text-ink">
        Переписка · {unwrap(order.requests)?.title ?? 'Заказ'}
      </h1>
      <p className="mt-1 text-sm text-muted">
        Покупатель, каждый поставщик и внутренние заметки разделены отдельными тредами. История
        доступна staff целиком.
      </p>

      {threads.length === 0 ? (
        <div className="mt-6 rounded-card border border-rule bg-surface p-8 text-center">
          <p className="text-sm font-semibold text-ink">Тредов пока нет</p>
          <p className="mt-1 text-fine text-muted">Они создаются вместе с заявкой и заказом.</p>
        </div>
      ) : (
        <div className="mt-6 grid min-h-[520px] grid-cols-1 overflow-hidden rounded-card border border-rule bg-surface lg:grid-cols-[280px_1fr]">
          <div className="hidden border-rule border-r lg:block">
            <ul>
              {threads.map((thread) => (
                <li key={thread.id}>
                  <Link
                    href={`/concierge/orders/${order.id}/messages?thread=${thread.id}`}
                    className={cn(
                      'block border-rule border-b px-4 py-3 text-fine',
                      thread.id === active?.id ? 'bg-page' : 'hover:bg-page/60',
                    )}
                  >
                    <p className="font-semibold text-ink">{threadLabel(thread)}</p>
                    <p className="mt-0.5 text-micro text-muted">
                      {thread.kind === 'internal' ? 'Только сотрудники QAJET' : 'Рабочая переписка'}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex min-w-0 flex-col">
            <div className="border-rule border-b px-6 py-4">
              <p className="text-sm font-semibold text-ink">
                {active ? threadLabel(active) : 'Тред'}
              </p>
              <p className="text-fine text-muted">{active ? threadDescription(active) : ''}</p>
            </div>
            <div className="flex min-h-64 flex-1 flex-col gap-3.5 overflow-y-auto p-6">
              {active && <MarkThreadRead threadId={active.id} />}
              {messages.length === 0 ? (
                <p className="m-auto text-fine text-muted">Сообщений пока нет.</p>
              ) : (
                messages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    returnPath={`/concierge/orders/${order.id}/messages?thread=${active?.id ?? ''}`}
                  />
                ))
              )}
            </div>
            {active && (
              <MessageComposer
                threadId={active.id}
                returnPath={`/concierge/orders/${order.id}/messages?thread=${active.id}`}
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
                returnPath={`/concierge/orders/${order.id}/messages?thread=${active.id}`}
              />
            )}
          </div>
        </div>
      )}
    </Reveal>
  );
}

function unwrap<T>(value: Nested<T>): T | undefined {
  return Array.isArray(value) ? value[0] : (value ?? undefined);
}

function threadLabel(thread: ThreadRow): string {
  if (thread.kind === 'buyer') return 'Покупатель';
  if (thread.kind === 'internal') return 'Внутренние заметки';
  return unwrap(thread.companies)?.name ?? 'Поставщик';
}

function threadDescription(thread: ThreadRow): string {
  if (thread.kind === 'internal') return 'Не видно покупателю и поставщикам';
  if (thread.kind === 'buyer') return 'Видно покупателю и staff';
  return 'Видно выбранной компании-поставщику и staff';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}
