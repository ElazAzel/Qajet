import { formatDate } from './dates';

/**
 * Что показывает строка доски консьержа помимо названия и стадии — аудит F6.
 * Утренний вопрос консьержа: что просрочено и у кого сейчас мяч.
 */

export interface BoardDeadline {
  text: string;
  overdue: boolean;
}

/** Разбор даты по частям: `deadline_date` — это DATE, без времени и пояса. */
function toUtcDays(date: string): number | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!parts) return null;
  return Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])) / 86_400_000;
}

/**
 * Срок в виде, пригодном для беглого взгляда.
 *
 * Обе даты переводятся в число суток UTC. Сравнивать `new Date(deadline)` с
 * локальной полночью нельзя: в UTC+5 вчерашний срок выглядел бы сегодняшним.
 */
export function formatBoardDeadline(deadlineDate: string | null, today: string): BoardDeadline {
  if (!deadlineDate) return { text: 'срок не указан', overdue: false };

  const deadlineDays = toUtcDays(deadlineDate);
  const todayDays = toUtcDays(today);
  if (deadlineDays === null || todayDays === null) {
    return { text: 'срок не указан', overdue: false };
  }

  const diff = deadlineDays - todayDays;
  if (diff < 0) {
    const days = Math.abs(diff);
    return { text: `просрочено на ${days} ${plural(days, 'день', 'дня', 'дней')}`, overdue: true };
  }
  if (diff === 0) return { text: 'срок сегодня', overdue: false };

  const shown = formatDate(deadlineDate);
  return { text: `к ${shown} · ${diff} ${plural(diff, 'день', 'дня', 'дней')}`, overdue: false };
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = count % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
