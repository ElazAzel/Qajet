import { timingSafeEqual } from 'node:crypto';

/**
 * Авторизация фоновых задач (`/api/jobs/*`). Задачи работают под
 * service_role, поэтому проверка закрыта всегда: раньше при незаданном
 * CRON_SECRET и NODE_ENV != production они были открыты любому, а у проекта
 * есть preview-деплои. Локально секрет задаёт `.env.local`.
 */
export function isCronAuthorized(request: Request, secret = process.env.CRON_SECRET): boolean {
  const expected = secret?.trim();
  if (!expected) return false;
  const given = request.headers.get('authorization') ?? '';
  const want = Buffer.from(`Bearer ${expected}`);
  const got = Buffer.from(given);
  return want.length === got.length && timingSafeEqual(want, got);
}
