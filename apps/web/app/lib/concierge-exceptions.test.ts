import { describe, expect, it } from 'vitest';
import { formatAlmatyDate } from './concierge-exceptions';

/**
 * Срок в очереди консьержа и в тексте WhatsApp-напоминания должен быть одной и той
 * же датой. Сервер Vercel живёт в UTC, а Алматы — UTC+5: срок 25 сентября в 20:00
 * UTC — это уже 26 сентября у поставщика.
 */
describe('formatAlmatyDate', () => {
  it('shows the Almaty calendar date, not the server one', () => {
    expect(formatAlmatyDate('2026-09-25T20:00:00Z')).toBe('26 сент.');
  });

  it('shows a dash when there is no date', () => {
    expect(formatAlmatyDate(null)).toBe('—');
  });
});
