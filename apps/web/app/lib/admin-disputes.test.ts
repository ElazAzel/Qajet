import { describe, expect, it } from 'vitest';
import { disputeAgeLabel } from './admin-disputes';

/** Аудит, «Споры»: в журнале видно, как давно спор ждёт решения. */
describe('disputeAgeLabel', () => {
  const now = new Date('2026-09-24T10:00:00Z');

  it('counts whole days since the dispute was opened', () => {
    expect(disputeAgeLabel('2026-09-01T09:00:00Z', now)).toBe('открыт 23 дня');
    expect(disputeAgeLabel('2026-09-23T09:00:00Z', now)).toBe('открыт 1 день');
    expect(disputeAgeLabel('2026-09-19T09:00:00Z', now)).toBe('открыт 5 дней');
  });

  it('says today for a dispute opened less than a day ago', () => {
    expect(disputeAgeLabel('2026-09-24T08:00:00Z', now)).toBe('открыт сегодня');
  });

  it('does not invent an age without a date', () => {
    expect(disputeAgeLabel(null, now)).toBe('дата открытия неизвестна');
  });
});
