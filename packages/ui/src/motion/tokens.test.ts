import { describe, expect, it } from 'vitest';
import { duration, seconds, variantBarChoreography } from './tokens';

describe('seconds', () => {
  it('переводит миллисекунды токена в секунды для Motion', () => {
    expect(seconds('instant')).toBeCloseTo(0.12);
    expect(seconds('quick')).toBeCloseTo(0.18);
    expect(seconds('base')).toBeCloseTo(0.24);
    expect(seconds('deliberate')).toBeCloseTo(0.42);
  });
});

describe('variantBarChoreography — сигнатурная сцена §12', () => {
  it('длительность сцены не разошлась с токеном duration.deliberate', () => {
    // Правило из agents.md §12: "новых длительностей не заводить" — сцена
    // роста полос обязана читать длительность из общего токена, а не
    // держать своё магическое число, которое можно незаметно поправить.
    expect(variantBarChoreography.durationMs).toBe(duration.deliberate);
  });

  it('длительность сигнатурной сцены остаётся самой долгой ролью в системе', () => {
    const allDurations = Object.values(duration);
    expect(variantBarChoreography.durationMs).toBe(Math.max(...allDurations));
  });
});
