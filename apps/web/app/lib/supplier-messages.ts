import type { SupabaseClient } from '@supabase/supabase-js';
import type { BuyerThreadPreview } from './buyer-messages';
import { readQueryRows } from './data/query-rows';
import { loadThreadHistory } from './data/thread-history';
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
  const data = await readQueryRows(() =>
    supabase.from('threads').select('id, order_id, orders(requests(title))').eq('kind', 'supplier'),
  );
  const rows = (data ?? []) as SupplierThreadRow[];
  if (rows.length === 0) return [];
  const { lastByThread, unreadByThread } = await loadThreadHistory(
    supabase,
    rows.map((row) => row.id),
    currentUserId,
  );

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
    .sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? '') || a.id.localeCompare(b.id));
}
