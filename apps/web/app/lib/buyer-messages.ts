import type { SupabaseClient } from '@supabase/supabase-js';

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
}

export interface ThreadMessage {
  id: string;
  body: string;
  createdAt: string;
  mine: boolean;
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
}

function unwrap<T>(value: Nested<T>): T | undefined {
  return Array.isArray(value) ? value[0] : (value ?? undefined);
}

function titleOf(row: ThreadRow): string {
  return unwrap(unwrap(row.orders)?.requests)?.title ?? 'Заказ';
}

export async function loadBuyerThreads(supabase: SupabaseClient): Promise<BuyerThreadPreview[]> {
  const { data: threadRows } = await supabase
    .from('threads')
    .select('id, order_id, orders(requests(title))')
    .eq('kind', 'buyer');

  const threads = (threadRows ?? []) as ThreadRow[];
  if (threads.length === 0) return [];

  // Последнее сообщение каждого треда — одним запросом по всем тредам, а не
  // по запросу на тред: тредов столько же, сколько заказов у компании.
  const { data: messageRows } = await supabase
    .from('messages')
    .select('thread_id, body, created_at')
    .in(
      'thread_id',
      threads.map((t) => t.id),
    )
    .order('created_at', { ascending: false });

  const lastByThread = new Map<string, { body: string; created_at: string }>();
  for (const message of messageRows ?? []) {
    if (!lastByThread.has(message.thread_id)) lastByThread.set(message.thread_id, message);
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
