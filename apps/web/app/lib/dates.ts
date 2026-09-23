/**
 * Даты на экране и в письмах — по календарю Алматы.
 *
 * Сервер Vercel работает в UTC, а пользователи — в UTC+5: срок 25 сентября в
 * 20:00 UTC — это уже 26 сентября. Без явного `timeZone` `toLocaleDateString`
 * показывает дату сервера, поэтому пользовательские даты форматируются только здесь.
 *
 * Значение вида `YYYY-MM-DD` — это колонка DATE: календарный день без времени и
 * пояса. Его показываем как есть, не сдвигая ни в какой пояс.
 */

export const APP_TIME_ZONE = 'Asia/Almaty';

type DateInput = string | Date | null | undefined;
type FormatOptions = Omit<Intl.DateTimeFormatOptions, 'timeZone'>;

/** «26.09.2026» — прежний вид `toLocaleDateString('ru-RU')` без параметров. */
export const NUMERIC_DATE: FormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };

/** «26.09.2026, 01:30:00» — прежний вид `toLocaleString('ru-RU')` без параметров. */
export const NUMERIC_DATE_TIME: FormatOptions = {
  ...NUMERIC_DATE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
};

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMPTY = '—';

function resolve(value: DateInput): { date: Date; timeZone: string } | null {
  if (!value) return null;
  const calendar = typeof value === 'string' && CALENDAR_DATE.test(value);
  const date = calendar ? new Date(`${value}T00:00:00Z`) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return { date, timeZone: calendar ? 'UTC' : APP_TIME_ZONE };
}

/** Дата, по умолчанию «26 сент.». Пустое или нечитаемое значение — «—». */
export function formatDate(
  value: DateInput,
  options: FormatOptions = { day: 'numeric', month: 'short' },
): string {
  const resolved = resolve(value);
  if (!resolved) return EMPTY;
  return resolved.date.toLocaleDateString('ru-RU', { ...options, timeZone: resolved.timeZone });
}

/** Дата со временем, по умолчанию «26 сент., 01:30». */
export function formatDateTime(
  value: DateInput,
  options: FormatOptions = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' },
): string {
  const resolved = resolve(value);
  if (!resolved) return EMPTY;
  return resolved.date.toLocaleString('ru-RU', { ...options, timeZone: resolved.timeZone });
}

/** Сегодняшний день в Алматы как `YYYY-MM-DD` — для сравнения с колонками DATE. */
export function almatyToday(now: Date = new Date()): string {
  // en-CA даёт ровно ISO-порядок: 2026-09-25.
  return now.toLocaleDateString('en-CA', { timeZone: APP_TIME_ZONE });
}
