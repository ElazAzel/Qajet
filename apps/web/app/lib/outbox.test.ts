import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildRfqNotification,
  formatOutboxBody,
  outboxDeliveryNote,
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

  it('names the reply deadline by the Almaty calendar', () => {
    vi.stubEnv('LINK_SIGNING_SECRET', 'rfq-test-secret');
    const message = buildRfqNotification({
      rfqId: 'rfq-1',
      token: 'token',
      requestTitle: 'Мерч для команды',
      respondBy: '2026-09-25T20:00:00.000Z',
      recipient: 'supplier@example.kz',
    });

    expect(message.body).toContain('Ответьте до 26.09.2026.');
  });
});

/**
 * Аудит F9: «Отправлено» не значит «доставлено». Экран обязан различать письмо,
 * принятое провайдером, и запись, которая осела в локальном журнале.
 */
describe('outboxDeliveryNote', () => {
  it('names the provider when the provider accepted the message', () => {
    expect(outboxDeliveryNote('sent', 're_123')).toBe('Принято Resend, id re_123');
  });

  it('never presents a local-sink row as delivered', () => {
    expect(outboxDeliveryNote('sent', 'local:rfq-invitation:1')).toBe(
      'Только локальный журнал: письмо никуда не ушло',
    );
  });

  it('says nothing about delivery before the message was sent', () => {
    expect(outboxDeliveryNote('pending', null)).toBeNull();
    expect(outboxDeliveryNote('failed', null)).toBeNull();
  });

  it('flags a sent row without any provider id instead of implying delivery', () => {
    expect(outboxDeliveryNote('sent', null)).toBe(
      'Отправка без id провайдера: доставка не подтверждена',
    );
  });
});
