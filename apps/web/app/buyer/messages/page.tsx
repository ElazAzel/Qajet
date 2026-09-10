import { cn } from '@qajet/ui/lib/cn';
import { Reveal } from '@qajet/ui/motion';
import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { loadBuyerThreads, loadThreadMessages } from '../../lib/buyer-messages';
import { requireCurrentUser } from '../../lib/current-user';
import { MessageComposer } from './_composer';

/**
 * Сообщения — переписка покупателя с QAJET по заказам (`threads`/`messages`,
 * agents.md §5, `kind='buyer'`). §10 «Покупатель»: личность исполнителя не
 * раскрывается — покупатель переписывается с QAJET, а не с компанией-
 * исполнителем, поэтому вторая сторона везде подписана «QAJET».
 *
 * Открытый тред выбирается через `?thread=`, а не клиентским состоянием:
 * сообщения читаются на сервере под RLS-сессией пользователя, и ссылка на
 * конкретную переписку остаётся ссылкой (её можно открыть, обновить,
 * вернуться назад).
 */

const avatarClass = 'rounded-control bg-page';

export default async function BuyerMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string }>;
}) {
  const user = await requireCurrentUser();
  const { thread: threadParam } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const threads = await loadBuyerThreads(supabase);

  const active = threads.find((t) => t.id === threadParam) ?? threads[0];
  const messages = active ? await loadThreadMessages(supabase, active.id, user.id) : [];

  if (threads.length === 0) {
    return (
      <Reveal>
        <h1 className="mb-5 text-3xl font-extrabold">Сообщения</h1>
        <div className="rounded-card border border-rule bg-surface p-8 text-center">
          <p className="text-sm font-semibold">Переписок пока нет</p>
          <p className="mx-auto mt-2 max-w-sm text-fine text-muted">
            Тред заводится вместе с заказом — как только вы отправите заявку и QAJET возьмёт её в
            работу, обсуждение появится здесь.
          </p>
        </div>
      </Reveal>
    );
  }

  return (
    <Reveal>
      <h1 className="mb-5 text-3xl font-extrabold">Сообщения</h1>
      {/* lg, не md: список тредов (320px) появляется вместе с сайдбаром
          оболочки (тоже md:flex, 240px) — на планшете (768px) оба разом
          оставляли треду ~200px, нечитаемо. */}
      <div className="grid h-[calc(100vh-260px)] min-h-[520px] grid-cols-1 overflow-hidden rounded-card border border-rule bg-surface lg:grid-cols-[320px_1fr]">
        <div className="hidden flex-col border-rule border-r lg:flex">
          <ul className="flex-1 overflow-y-auto">
            {threads.map((thread) => (
              <li key={thread.id}>
                <Link
                  href={`/buyer/messages?thread=${thread.id}`}
                  className={cn(
                    'flex w-full items-start gap-3 border-rule border-b px-4 py-3.5 text-left',
                    thread.id === active?.id ? 'bg-page' : 'hover:bg-page/60',
                  )}
                >
                  <span className={cn(avatarClass, 'h-10 w-10 shrink-0')} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-semibold">{thread.orderTitle}</span>
                      <span className="shrink-0 text-micro text-muted">
                        {formatTime(thread.lastAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-fine text-muted">QAJET</span>
                    <span className="mt-0.5 block truncate text-fine text-muted">
                      {thread.lastMessage}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col">
          <div className="flex items-center gap-3 border-rule border-b px-6 py-4">
            <span className={cn(avatarClass, 'h-10 w-10 shrink-0')} aria-hidden="true" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{active?.orderTitle}</p>
              <p className="text-fine text-muted">QAJET</p>
            </div>
            {active?.orderId && (
              <Link
                href={`/buyer/orders/${active.orderId}`}
                className="ml-auto shrink-0 text-fine font-semibold text-purple"
              >
                Открыть заказ →
              </Link>
            )}
          </div>

          <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto p-6">
            {messages.length === 0 ? (
              <p className="m-auto text-fine text-muted">Сообщений пока нет — напишите первым.</p>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={cn('flex', message.mine ? 'justify-end' : 'justify-start')}
                >
                  <p
                    className={cn(
                      'max-w-[60%] rounded-control px-4 py-2.5 text-fine leading-relaxed',
                      message.mine ? 'bg-purple text-white' : 'bg-page text-ink',
                    )}
                  >
                    {message.body}
                  </p>
                </div>
              ))
            )}
          </div>

          {active && <MessageComposer threadId={active.id} />}
        </div>
      </div>
    </Reveal>
  );
}

function formatTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
