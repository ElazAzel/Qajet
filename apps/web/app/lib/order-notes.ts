import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Внутренние заметки консьержа по заказу — agents.md §5, §10: «видны
 * только сотрудникам QAJET». `threads.kind='internal'` уже физически
 * закрыт от покупателя и поставщика на уровне RLS (миграция 0000) — здесь
 * читающая часть, пишущая — в `actions/order-actions.ts` (`addInternalNote`).
 */

export interface OrderNote {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
}

export async function loadOrderNotes(
  supabase: SupabaseClient,
  orderId: string,
): Promise<OrderNote[]> {
  const { data: thread } = await supabase
    .from('threads')
    .select('id')
    .eq('order_id', orderId)
    .eq('kind', 'internal')
    .maybeSingle();
  if (!thread) return [];

  const { data } = await supabase
    .from('messages')
    .select('id, body, created_at, users(full_name)')
    .eq('thread_id', thread.id)
    .order('created_at', { ascending: true });

  return (data ?? []).map((row) => {
    const author = Array.isArray(row.users) ? row.users[0] : row.users;
    return {
      id: row.id,
      body: row.body,
      authorName: author?.full_name ?? '—',
      createdAt: row.created_at,
    };
  });
}
