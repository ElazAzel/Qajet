import 'server-only';

export interface EmailMessage {
  idempotencyKey: string;
  recipient: string;
  subject: string;
  body: string;
}

export interface EmailDeliveryResult {
  providerMessageId: string;
  transport: 'resend' | 'local-sink';
}

export interface EmailAdapter {
  send(message: EmailMessage): Promise<EmailDeliveryResult>;
}

class LocalSinkAdapter implements EmailAdapter {
  async send(message: EmailMessage): Promise<EmailDeliveryResult> {
    return { providerMessageId: `local:${message.idempotencyKey}`, transport: 'local-sink' };
  }
}

class ResendAdapter implements EmailAdapter {
  constructor(private readonly apiKey: string) {}

  async send(message: EmailMessage): Promise<EmailDeliveryResult> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': message.idempotencyKey,
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL ?? 'QAJET <onboarding@resend.dev>',
        to: [message.recipient],
        subject: message.subject,
        text: message.body,
      }),
    });
    const payload = (await response.json().catch(() => null)) as {
      id?: string;
      message?: string;
    } | null;
    if (!response.ok || !payload?.id) {
      throw new Error(payload?.message ?? `Resend вернул HTTP ${response.status}`);
    }
    return { providerMessageId: payload.id, transport: 'resend' };
  }
}

/**
 * В production без RESEND_API_KEY отправки не будет, и об этом надо сказать
 * сразу. Раньше здесь возвращался LocalSinkAdapter, который отвечает успехом:
 * очередь помечала уведомление отправленным, письмо никуда не уходило, а
 * /admin/outbox выглядел чистым. Поставщик, не получивший RFQ, для всех
 * выглядел уведомлённым. Локальный приёмник остаётся только вне production.
 */
export function createEmailAdapter(): EmailAdapter {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (apiKey) return new ResendAdapter(apiKey);
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Почта не настроена: в production не задан RESEND_API_KEY');
  }
  return new LocalSinkAdapter();
}
