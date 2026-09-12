import type { createSupabaseServerClient } from '@/lib/supabase/server';
import type { OutboxMessageInput } from './outbox';

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Dev-first notification adapter: сохраняет сообщение в outbox. Реальный
 * worker/Resend может забрать pending-строки позже. Бизнес-action не зависит
 * от наличия внешнего ключа; ошибка записи возвращается вызывающему коду для
 * логирования, а не превращается в ложный успех отправки.
 */
export async function enqueueOutbox(
  supabase: SupabaseServerClient,
  messages: OutboxMessageInput[],
): Promise<string | null> {
  if (messages.length === 0) return null;

  const { error } = await supabase.from('outbox').insert(
    messages.map((message) => ({
      channel: message.channel ?? 'email',
      kind: message.kind,
      recipient: message.recipient,
      subject: message.subject,
      body: message.body,
      payload: message.payload ?? {},
      status: 'pending',
      attempts: 0,
    })),
  );
  return error?.message ?? null;
}
