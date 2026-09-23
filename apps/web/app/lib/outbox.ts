import { createRfqResponseToken } from './rfq-response';

export type OutboxStatus = 'pending' | 'processing' | 'sent' | 'failed';
export type OutboxStatusTone = 'attention' | 'success' | 'danger' | 'neutral';

export interface OutboxMessageInput {
  channel?: string;
  kind: string;
  recipient: string;
  subject: string;
  body: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
}

const STATUS_LABELS: Record<OutboxStatus, string> = {
  pending: 'В очереди',
  processing: 'Отправляется',
  sent: 'Отправлено',
  failed: 'Ошибка',
};

const STATUS_TONES: Record<OutboxStatus, OutboxStatusTone> = {
  pending: 'attention',
  processing: 'attention',
  sent: 'success',
  failed: 'danger',
};

/** Подготовить тело уведомления к однострочному превью в админке. */
export function formatOutboxBody(body: string, maxLength = 96): string {
  const normalized = body.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function outboxStatusLabel(status: string): string {
  return STATUS_LABELS[status as OutboxStatus] ?? 'Неизвестно';
}

export function outboxStatusTone(status: string): OutboxStatusTone {
  return STATUS_TONES[status as OutboxStatus] ?? 'neutral';
}

/**
 * Что известно о доставке отправленной записи (аудит F9). «Отправлено» — статус
 * очереди, а не факт доставки: локальный журнал помечает запись `local:` и не
 * должен выглядеть как письмо, дошедшее до человека.
 */
export function outboxDeliveryNote(
  status: string,
  providerMessageId: string | null,
): string | null {
  if (status !== 'sent') return null;
  if (!providerMessageId) return 'Отправка без id провайдера: доставка не подтверждена';
  if (providerMessageId.startsWith('local:')) {
    return 'Только локальный журнал: письмо никуда не ушло';
  }
  return `Принято Resend, id ${providerMessageId}`;
}

export function buildRfqNotification(input: {
  rfqId: string;
  token: string;
  requestTitle: string;
  respondBy: string;
  recipient: string;
}): OutboxMessageInput {
  const signedToken = createRfqResponseToken(input.rfqId, input.token);
  const path = `/rfq/respond/${encodeURIComponent(signedToken)}`;
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
  const responseUrl = baseUrl ? `${baseUrl}${path}` : path;

  return {
    kind: 'rfq_invitation',
    idempotencyKey: `rfq-invitation:${input.rfqId}`,
    recipient: input.recipient,
    subject: `QAJET: запрос предложения — ${input.requestTitle}`,
    body: [
      `Новая заявка QAJET: ${input.requestTitle}.`,
      `Ответьте до ${new Date(input.respondBy).toLocaleDateString('ru-RU')}.`,
      `Открыть RFQ: ${responseUrl}`,
    ].join('\n'),
    payload: {
      rfqId: input.rfqId,
      token: input.token,
      requestTitle: input.requestTitle,
      respondBy: input.respondBy,
    },
  };
}
