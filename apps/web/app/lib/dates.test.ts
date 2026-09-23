import { describe, expect, it } from 'vitest';
import { almatyToday, formatDate, formatDateTime, NUMERIC_DATE, NUMERIC_DATE_TIME } from './dates';

/**
 * Сервер Vercel живёт в UTC, а Алматы — UTC+5: срок 25 сентября в 20:00 UTC — это
 * уже 26 сентября у пользователя. Запускать с `TZ=UTC`, чтобы воспроизвести сервер.
 */
describe('formatDate', () => {
  it('shows the Almaty calendar date of a moment, not the server one', () => {
    expect(formatDate('2026-09-25T20:00:00Z')).toBe('26 сент.');
    expect(formatDate('2026-09-25T18:59:59Z')).toBe('25 сент.');
  });

  it('keeps a calendar date as it is: a DATE column has no time zone', () => {
    expect(formatDate('2026-09-25')).toBe('25 сент.');
  });

  it('passes the caller format through', () => {
    expect(formatDate('2026-09-25T20:00:00Z', NUMERIC_DATE)).toBe('26.09.2026');
    expect(formatDate('2026-09-30T20:00:00Z', { month: 'long', year: 'numeric' })).toBe(
      'октябрь 2026 г.',
    );
  });

  it('shows a dash when there is no usable date', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('not a date')).toBe('—');
  });
});

describe('formatDateTime', () => {
  it('shows Almaty wall-clock time', () => {
    expect(formatDateTime('2026-09-25T20:30:00Z')).toBe('26 сент., 01:30');
    expect(formatDateTime('2026-09-25T20:30:00Z', NUMERIC_DATE_TIME)).toBe('26.09.2026, 01:30:00');
  });

  it('shows a dash when there is no usable date', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('not a date')).toBe('—');
  });
});

describe('almatyToday', () => {
  it('turns over at Almaty midnight, not at UTC midnight', () => {
    expect(almatyToday(new Date('2026-09-24T18:59:59Z'))).toBe('2026-09-24');
    expect(almatyToday(new Date('2026-09-24T19:00:00Z'))).toBe('2026-09-25');
  });
});
