import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildRfqNotification,
  formatOutboxBody,
  outboxStatusLabel,
  outboxStatusTone,
} from './outbox';
import { verifyRfqResponseToken } from './rfq-response';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('outbox presentation helpers', () => {
  it('uses a bounded single-line preview for an outgoing message', () => {
    expect(formatOutboxBody('  RFQ\n\nНужны футболки\nс логотипом  ')).toBe(
      'RFQ Нужны футболки с логотипом',
    );
    expect(formatOutboxBody('123456789', 6)).toBe('12345…');
  });

  it.each([
    ['pending', 'В очереди', 'attention'],
    ['sent', 'Отправлено', 'success'],
    ['failed', 'Ошибка', 'danger'],
  ] as const)('maps %s to a human status', (status, label, tone) => {
    expect(outboxStatusLabel(status)).toBe(label);
    expect(outboxStatusTone(status)).toBe(tone);
  });

  it('falls back safely for an unknown status from an old row', () => {
    expect(outboxStatusLabel('unknown')).toBe('Неизвестно');
    expect(outboxStatusTone('unknown')).toBe('neutral');
  });

  it('builds a notification with an encoded public RFQ path and trace payload', () => {
    vi.stubEnv('LINK_SIGNING_SECRET', 'rfq-test-secret');
    const message = buildRfqNotification({
      rfqId: 'rfq-1',
      token: 'token/with space',
      requestTitle: 'Мерч для команды',
      respondBy: '2026-09-15T00:00:00.000Z',
      recipient: 'supplier@example.kz',
    });

    expect(message.kind).toBe('rfq_invitation');
    const responseUrl = message.body.match(/\/rfq\/respond\/([^\n]+)/)?.[1];
    expect(responseUrl).toBeTruthy();
    expect(verifyRfqResponseToken(decodeURIComponent(responseUrl ?? ''))).toEqual({
      rfqId: 'rfq-1',
      nonce: 'token/with space',
    });
    expect(message.payload).toEqual({
      rfqId: 'rfq-1',
      token: 'token/with space',
      requestTitle: 'Мерч для команды',
      respondBy: '2026-09-15T00:00:00.000Z',
    });
  });
});
