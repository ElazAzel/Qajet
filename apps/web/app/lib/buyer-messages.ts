import type { SupabaseClient } from '@supabase/supabase-js';
import { threadTitle } from './thread-title';

/**
 * Переписка покупателя с QAJET по заказам — `threads`/`messages`
 * (agents.md §5), только `kind='buyer'`. §10 «Покупатель»: личность
 * исполнителя не раскрывается, покупатель переписывается с QAJET, а не с
 * компанией-исполнителем, поэтому автор сообщения показывается как «вы»
 * или «QAJET», без имён сотрудников исполнителя.
 *
 * Треды `internal` и `supplier` сюда не попадают вообще: их отсекает RLS
 * (`threads_select_buyer` пускает покупателя только к `kind='buyer'`), а не
 * фильтр в этом запросе — здесь `.eq('kind', 'buyer')` стоит ради ясности
 * запроса, но защита не на нём.
 *
 * До этой правки экран показывал пять зашитых в файл переписок с
 * выдуманными номерами заказов и текстами, а поле ввода не отправляло
 * ничего.
 */

export interface BuyerThreadPreview {
  id: string;
  orderId: string | null;
  orderTitle: string;
  lastMessage: string;
  lastAt: string | null;
  unreadCount: number;
}

export interface ThreadMessage {
  id: string;
  body: string;
  createdAt: string;
  mine: boolean;
}

export interface ThreadAttachment {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

/**
 * PostgREST отдаёт вложенные связи то объектом, то массивом в зависимости
 * от кардинальности, и типизация клиента это отражает — распаковываем оба
 * случая, а не приводим силой.
 */
type Nested<T> = T | T[] | null | undefined;

interface ThreadRow {
  id: string;
  order_id: string | null;
  orders: Nested<{ requests: Nested<{ title: string }> }>;
  requests: Nested<{ title: string }>;
}

function unwrap<T>(value: Nested<T>): T | undefined {
  return Array.isArray(value) ? value[0] : (value ?? undefined);
}

function titleOf(row: ThreadRow): string {
  // Беседа начинается по заявке и продолжается по заказу. Пока заказа нет,
  // связь через orders пуста — и раньше строка называлась просто «Заказ»,
  // из-за чего весь список выглядел одинаково (аудит F5).
  return threadTitle({
    orderRequestTitle: unwrap(unwrap(row.orders)?.requests)?.title,
    ownRequestTitle: unwrap(row.requests)?.title,
  });
}

export async function loadBuyerThreads(
  supabase: SupabaseClient,
  currentUserId?: string,
): Promise<BuyerThreadPreview[]> {
  const { data: threadRows } = await supabase
    .from('threads')
    .select('id, order_id, orders(requests(title)), requests(title)')
    .eq('kind', 'buyer');

  const threads = (threadRows ?? []) as ThreadRow[];
  if (threads.length === 0) return [];

  // Последнее сообщение каждого треда — одним запросом по всем тредам, а не
  // по запросу на тред: тредов столько же, сколько заказов у компании.
  const { data: messageRows } = await supabase
    .from('messages')
    .select('thread_id, body, created_at, author_user_id')
    .in(
      'thread_id',
      threads.map((t) => t.id),
    )
    .order('created_at', { ascending: false });

  const lastByThread = new Map<string, { body: string; created_at: string }>();
  for (const message of messageRows ?? []) {
    if (!lastByThread.has(message.thread_id)) lastByThread.set(message.thread_id, message);
  }

  const { data: readRows } = currentUserId
    ? await supabase
        .from('thread_reads')
        .select('thread_id, last_read_at')
        .eq('user_id', currentUserId)
        .in(
          'thread_id',
          threads.map((thread) => thread.id),
        )
    : { data: [] };
  const lastReadByThread = new Map(
    (readRows ?? []).map((row) => [row.thread_id, row.last_read_at] as const),
  );
  const unreadByThread = new Map<string, number>();
  if (currentUserId) {
    for (const message of messageRows ?? []) {
      if (
        message.author_user_id !== currentUserId &&
        message.created_at > (lastReadByThread.get(message.thread_id) ?? '')
      ) {
        unreadByThread.set(message.thread_id, (unreadByThread.get(message.thread_id) ?? 0) + 1);
      }
    }
  }

  return threads
    .map((row) => {
      const last = lastByThread.get(row.id);
      return {
        id: row.id,
        orderId: row.order_id,
        orderTitle: titleOf(row),
        lastMessage: last?.body ?? 'Переписка ещё не начата',
        lastAt: last?.created_at ?? null,
        unreadCount: unreadByThread.get(row.id) ?? 0,
      };
    })
    .sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));
}

export async function loadThreadMessages(
  supabase: SupabaseClient,
  threadId: string,
  currentUserId: string,
): Promise<ThreadMessage[]> {
  const { data } = await supabase
    .from('messages')
    .select('id, body, created_at, author_user_id')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });

  return (data ?? []).map((row) => ({
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    mine: row.author_user_id === currentUserId,
  }));
}

export async function loadThreadAttachments(
  supabase: SupabaseClient,
  threadId: string,
): Promise<ThreadAttachment[]> {
  const { data } = await supabase
    .from('attachments')
    .select('id, file_name, content_type, size_bytes')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });
  return (data ?? []).map((row) => ({
    id: row.id,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
  }));
}
