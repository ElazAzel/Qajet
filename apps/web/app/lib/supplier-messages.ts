import type { SupabaseClient } from '@supabase/supabase-js';
import type { BuyerThreadPreview } from './buyer-messages';
import { threadTitle } from './thread-title';

type Nested<T> = T | T[] | null | undefined;

interface SupplierThreadRow {
  id: string;
  order_id: string | null;
  orders: Nested<{ requests: Nested<{ title: string }> }>;
}

function unwrap<T>(value: Nested<T>): T | undefined {
  return Array.isArray(value) ? value[0] : (value ?? undefined);
}

export async function loadSupplierThreads(
  supabase: SupabaseClient,
  currentUserId?: string,
): Promise<BuyerThreadPreview[]> {
  const { data } = await supabase
    .from('threads')
    .select('id, order_id, orders(requests(title))')
    .eq('kind', 'supplier')
    .order('created_at', { ascending: false });
  const rows = (data ?? []) as SupplierThreadRow[];
  if (rows.length === 0) return [];
  const { data: messages } = await supabase
    .from('messages')
    .select('thread_id, body, created_at, author_user_id')
    .in(
      'thread_id',
      rows.map((row) => row.id),
    )
    .order('created_at', { ascending: false });
  const lastByThread = new Map<string, { body: string; created_at: string }>();
  for (const message of messages ?? []) {
    if (!lastByThread.has(message.thread_id)) lastByThread.set(message.thread_id, message);
  }
  const { data: readRows } = currentUserId
    ? await supabase
        .from('thread_reads')
        .select('thread_id, last_read_at')
        .eq('user_id', currentUserId)
        .in(
          'thread_id',
          rows.map((row) => row.id),
        )
    : { data: [] };
  const lastReadByThread = new Map(
    (readRows ?? []).map((row) => [row.thread_id, row.last_read_at] as const),
  );
  const unreadByThread = new Map<string, number>();
  if (currentUserId) {
    for (const message of messages ?? []) {
      if (
        message.author_user_id !== currentUserId &&
        message.created_at > (lastReadByThread.get(message.thread_id) ?? '')
      ) {
        unreadByThread.set(message.thread_id, (unreadByThread.get(message.thread_id) ?? 0) + 1);
      }
    }
  }
  return rows
    .map((row) => {
      // Треды поставщика всегда создаются с order_id, поэтому запасной вариант
      // здесь почти недостижим — но слово «Заказ» как название делает строки
      // неразличимыми, а «Без названия» честно говорит, что названия нет.
      const title = threadTitle({
        orderRequestTitle: unwrap(unwrap(row.orders)?.requests)?.title,
        ownRequestTitle: null,
      });
      const last = lastByThread.get(row.id);
      return {
        id: row.id,
        orderId: row.order_id,
        orderTitle: title,
        lastMessage: last?.body ?? 'Переписка ещё не начата',
        lastAt: last?.created_at ?? null,
        unreadCount: unreadByThread.get(row.id) ?? 0,
      };
    })
    .sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));
}
