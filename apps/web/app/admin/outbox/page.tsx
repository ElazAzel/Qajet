import { Reveal, Stamp, type StampTone } from '@qajet/ui/motion';
import { Card } from '@qajet/ui/primitives';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireActor } from '../../lib/current-user';
import {
  formatOutboxBody,
  type OutboxStatusTone,
  outboxStatusLabel,
  outboxStatusTone,
} from '../../lib/outbox';
import { RetryOutboxButton } from './_retry-button';

type OutboxRow = {
  id: string;
  channel: string;
  kind: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  attempts: number;
  last_error: string | null;
  delivery_error: string | null;
  leased_until: string | null;
  provider_message_id: string | null;
  created_at: string;
  sent_at: string | null;
};

const STAMP_TONE: Record<OutboxStatusTone, StampTone> = {
  attention: 'pending',
  success: 'success',
  danger: 'signal',
  neutral: 'neutral',
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function AdminOutboxPage() {
  await requireActor('admin');
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('outbox')
    .select(
      'id, channel, kind, recipient, subject, body, status, attempts, last_error, delivery_error, leased_until, provider_message_id, created_at, sent_at',
    )
    .order('created_at', { ascending: false })
    .limit(100);
  const rows = (data ?? []) as OutboxRow[];

  return (
    <div className="flex flex-col gap-6">
      <Reveal>
        <h1 className="text-2xl font-extrabold text-ink">Исходящие уведомления</h1>
        <p className="mt-1.5 text-sm text-muted">
          Dev-очередь email и других каналов. Здесь видно, что система поставила на отправку; ключ
          Resend не нужен для локального сценария.
        </p>
      </Reveal>

      <Reveal delay={0.12}>
        <Card>
          {error ? (
            <p className="text-fine text-danger">
              Очередь пока недоступна. Примените миграции базы данных, включая 0025 для outbox.
            </p>
          ) : rows.length === 0 ? (
            <p className="text-fine text-muted">
              Пока нет уведомлений. Они появятся после первой рассылки RFQ поставщикам.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-fine">
                <thead>
                  <tr className="border-rule border-b text-micro text-muted uppercase tracking-wide">
                    <th className="px-2 py-2.5 text-left font-semibold">Создано</th>
                    <th className="px-2 py-2.5 text-left font-semibold">Канал / тип</th>
                    <th className="px-2 py-2.5 text-left font-semibold">Получатель</th>
                    <th className="px-2 py-2.5 text-left font-semibold">Тема</th>
                    <th className="px-2 py-2.5 text-left font-semibold">Статус</th>
                    <th className="px-2 py-2.5 text-left font-semibold">Сообщение</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const statusTone = outboxStatusTone(row.status);
                    return (
                      <tr key={row.id} className="border-rule border-b align-top last:border-b-0">
                        <td className="whitespace-nowrap px-2 py-3 text-muted">
                          {formatDateTime(row.created_at)}
                        </td>
                        <td className="px-2 py-3">
                          <p className="font-semibold">{row.channel}</p>
                          <p className="text-micro text-muted">{row.kind}</p>
                        </td>
                        <td className="px-2 py-3 text-muted">{row.recipient}</td>
                        <td className="min-w-56 px-2 py-3 font-semibold">{row.subject}</td>
                        <td className="whitespace-nowrap px-2 py-3">
                          <Stamp tone={STAMP_TONE[statusTone]}>
                            {outboxStatusLabel(row.status)}
                          </Stamp>
                          <p className="mt-1 text-micro text-muted">
                            попыток: {row.attempts}
                            {row.sent_at ? ` · отправлено ${formatDateTime(row.sent_at)}` : ''}
                          </p>
                          {row.last_error && (
                            <p className="mt-1 max-w-48 text-micro text-danger">{row.last_error}</p>
                          )}
                          {row.delivery_error && row.delivery_error !== row.last_error && (
                            <p className="mt-1 max-w-48 text-micro text-danger">
                              Доставка: {row.delivery_error}
                            </p>
                          )}
                          {row.leased_until && row.status === 'processing' && (
                            <p className="mt-1 text-micro text-muted">
                              lease до {formatDateTime(row.leased_until)}
                            </p>
                          )}
                          {row.status === 'failed' && <RetryOutboxButton id={row.id} />}
                        </td>
                        <td className="min-w-64 px-2 py-3">
                          <p className="text-muted">{formatOutboxBody(row.body)}</p>
                          <details className="mt-2">
                            <summary className="cursor-pointer text-micro font-semibold text-purple">
                              Открыть тело
                            </summary>
                            <pre className="mt-2 max-w-xl whitespace-pre-wrap text-micro text-muted">
                              {row.body}
                            </pre>
                          </details>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Reveal>
    </div>
  );
}
