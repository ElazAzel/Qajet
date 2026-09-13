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

export function createEmailAdapter(): EmailAdapter {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  return apiKey ? new ResendAdapter(apiKey) : new LocalSinkAdapter();
}
