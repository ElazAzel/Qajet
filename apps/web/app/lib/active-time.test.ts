import { describe, expect, it } from 'vitest';
import { MAX_HEARTBEAT_SECONDS, secondsSinceLastHeartbeat } from './active-time';

describe('active time heartbeat', () => {
  it('counts only the current visible heartbeat and caps delayed gaps', () => {
    const startedAt = new Date('2026-09-13T10:00:00.000Z');
    expect(
      secondsSinceLastHeartbeat({
        startedAt,
        previousEndedAt: null,
        now: new Date('2026-09-13T10:00:20Z'),
      }),
    ).toBe(20);
    expect(
      secondsSinceLastHeartbeat({
        startedAt,
        previousEndedAt: new Date('2026-09-13T10:00:20Z'),
        now: new Date('2026-09-13T10:05:20Z'),
      }),
    ).toBe(MAX_HEARTBEAT_SECONDS);
  });

  it('does not count a replay or a clock that moved backwards', () => {
    const startedAt = new Date('2026-09-13T10:00:00.000Z');
    const endedAt = new Date('2026-09-13T10:00:30.000Z');
    expect(secondsSinceLastHeartbeat({ startedAt, previousEndedAt: endedAt, now: endedAt })).toBe(
      0,
    );
    expect(
      secondsSinceLastHeartbeat({
        startedAt,
        previousEndedAt: endedAt,
        now: new Date('2026-09-13T10:00:10Z'),
      }),
    ).toBe(0);
  });

  it('never starts counting before the declared session start', () => {
    expect(
      secondsSinceLastHeartbeat({
        startedAt: new Date('2026-09-13T10:00:30Z'),
        previousEndedAt: null,
        now: new Date('2026-09-13T10:00:00Z'),
      }),
    ).toBe(0);
  });
});
