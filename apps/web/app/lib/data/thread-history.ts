import type { SupabaseClient } from '@supabase/supabase-js';
import { readInBatches, readQueryRows } from './query-rows';

/** Shared by buyer/supplier previews so one busy thread cannot hide another. */
export async function loadThreadHistory(
  client: SupabaseClient,
  threadIds: string[],
  currentUserId?: string,
) {
  const cutoff = new Date().toISOString();
  const messages = await readInBatches(threadIds, (ids) =>
    readQueryRows(() =>
      client
        .from('messages')
        .select('id, thread_id, body, created_at, author_user_id')
        .in('thread_id', ids)
        .lte('created_at', cutoff),
    ),
  );
  messages.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  const readRows = currentUserId
    ? await readInBatches(threadIds, (ids) =>
        readQueryRows(
          () =>
            client
              .from('thread_reads')
              .select('id:thread_id, thread_id, last_read_at')
              .eq('user_id', currentUserId)
              .in('thread_id', ids),
          'thread_id',
        ),
      )
    : [];
  const lastReadByThread = new Map(
    readRows.map((row) => [row.thread_id, row.last_read_at] as const),
  );
  const lastByThread = new Map<string, { body: string; created_at: string }>();
  const unreadByThread = new Map<string, number>();
  for (const message of messages) {
    if (!lastByThread.has(message.thread_id)) lastByThread.set(message.thread_id, message);
    if (
      currentUserId &&
      message.author_user_id !== currentUserId &&
      message.created_at > (lastReadByThread.get(message.thread_id) ?? '')
    ) {
      unreadByThread.set(message.thread_id, (unreadByThread.get(message.thread_id) ?? 0) + 1);
    }
  }
  return { lastByThread, unreadByThread };
}
