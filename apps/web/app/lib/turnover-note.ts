import { formatKzt } from '@qajet/ui/primitives';

/**
 * Процент к прошлому месяцу показывается, только когда он осмыслен (аудит F10):
 * этот месяц уже что-то закрыл, и изменение не больше чем в четыре раза. Иначе
 * «+12797%» от почти нулевой базы и «−100%» в начале месяца только сбивают.
 */
const MAX_MEANINGFUL_CHANGE_PCT = 300;

export function turnoverNote(thisMonthKzt: number, lastMonthKzt: number): string {
  if (lastMonthKzt <= 0) return 'в прошлом месяце оборота не было';
  const base = `прошлый месяц ${formatKzt(lastMonthKzt)}`;
  if (thisMonthKzt <= 0) return base;
  const pct = Math.round(((thisMonthKzt - lastMonthKzt) / lastMonthKzt) * 100);
  if (Math.abs(pct) > MAX_MEANINGFUL_CHANGE_PCT) return base;
  return `${base} · ${pct >= 0 ? '+' : '−'}${Math.abs(pct)}%`;
}
