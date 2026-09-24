import { describe, expect, it } from 'vitest';
import { turnoverNote as note } from './turnover-note';

// Intl разделяет разряды неразрывным пробелом; сравниваем по смыслу, не по байтам.
const turnoverNote = (thisMonth: number, lastMonth: number) =>
  note(thisMonth, lastMonth).replace(/\s/g, ' ');

/**
 * Аудит F10: «+12797% к прошлому» и «−100% к прошлому» формально верны, но для
 * решения бесполезны — база около нуля или месяц только начался. Подпись
 * называет прошлый месяц суммой, а процент добавляет, только когда он осмыслен.
 */
describe('turnoverNote', () => {
  it('shows the percent for a comparable pair of months', () => {
    expect(turnoverNote(1_200_000, 1_000_000)).toBe('прошлый месяц 1 000 000 ₸ · +20%');
    expect(turnoverNote(800_000, 1_000_000)).toBe('прошлый месяц 1 000 000 ₸ · −20%');
  });

  it('drops a percent that says nothing: growth from a tiny base', () => {
    expect(turnoverNote(12_900_000, 100_000)).toBe('прошлый месяц 100 000 ₸');
  });

  it('drops −100% when this month has no closed orders yet', () => {
    expect(turnoverNote(0, 1_000_000)).toBe('прошлый месяц 1 000 000 ₸');
  });

  it('says so when there is nothing to compare with', () => {
    expect(turnoverNote(500_000, 0)).toBe('в прошлом месяце оборота не было');
  });
});
