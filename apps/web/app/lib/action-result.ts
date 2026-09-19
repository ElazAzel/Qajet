import { logActionFailure } from './server-log';

/**
 * Единый результат server action — qajet-master-spec.md и agents.md:
 * «стабильные безопасные коды и сообщения, непрозрачный supportId, никогда
 * сырые ошибки базы или провайдера».
 *
 * Поле с текстом называется `error`, а не `message`: так его уже читают
 * `useAsyncAction` и все клиентские компоненты, и переименование ничего не
 * дало бы пользователю.
 */
export type ActionErrorCode =
  | 'rejected'
  | 'invalid'
  | 'forbidden'
  | 'conflict'
  | 'not_found'
  | 'failed'
  | 'internal';

export interface ActionResult {
  ok: boolean;
  error?: string;
  code?: ActionErrorCode;
  /** Ошибки конкретных полей формы: ключ — имя поля, значение — текст рядом с ним. */
  fieldErrors?: Record<string, string>;
  /** Есть только у сбоев: по нему сбой находится в серверном журнале. */
  supportId?: string;
}

const GENERIC_FAILURE = 'Не удалось выполнить действие.';

interface Classified {
  business: boolean;
  code: ActionErrorCode;
  message: string;
  sqlstate: string | undefined;
  errorName: string;
}

function sqlstateOf(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^([0-9A-Z]{5}|PGRST\d{3})$/.test(code) ? code : undefined;
}

function messageOf(err: unknown): string {
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : '';
}

/**
 * Тексты RAISE EXCEPTION в миграциях — это авторские бизнес-сообщения
 * («Нужна причина от 5 до 2000 символов»), часть с техническим префиксом
 * `имя_функции: `. Префикс для человека бесполезен — снимаем его.
 */
export function cleanBusinessMessage(raw: string): string {
  const text = raw.replace(/^[a-z_][a-z0-9_]*:\s+/, '').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : GENERIC_FAILURE;
}

export function classifyError(err: unknown, fallback = GENERIC_FAILURE): Classified {
  const sqlstate = sqlstateOf(err);
  const raw = messageOf(err);
  const errorName = (err as { name?: unknown } | null)?.constructor?.name ?? 'unknown';
  const base = { sqlstate, errorName: typeof errorName === 'string' ? errorName : 'unknown' };

  // P0001 — RAISE EXCEPTION без явного кода: задуманный бизнес-отказ.
  // 23514 из RAISE ... USING ERRCODE — тоже; но не текст самого Postgres
  // о нарушенном CHECK-ограничении, в нём имена таблиц и ограничений.
  if (
    sqlstate === 'P0001' ||
    (sqlstate === '23514' && raw && !/violates check constraint/i.test(raw))
  ) {
    return { ...base, business: true, code: 'rejected', message: cleanBusinessMessage(raw) };
  }
  if (sqlstate === '42501') {
    return {
      ...base,
      business: false,
      code: 'forbidden',
      message: 'Недостаточно прав для этого действия.',
    };
  }
  if (sqlstate === '23505' || sqlstate === '40001' || sqlstate === '55P03') {
    return {
      ...base,
      business: false,
      code: 'conflict',
      message: 'Эти данные уже изменились. Обновите страницу и попробуйте снова.',
    };
  }
  if (sqlstate === 'PGRST116') {
    return {
      ...base,
      business: false,
      code: 'not_found',
      message: 'Запись не найдена или недоступна.',
    };
  }
  return { ...base, business: false, code: 'internal', message: fallback };
}

function newSupportId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
}

function withPeriod(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * Превращает любую ошибку в безопасный результат.
 *
 * - `err` пуст (запрос прошёл, но строки нет): бизнес-результат с `fallback`.
 * - Бизнес-отказ из RPC: его собственный текст, без supportId.
 * - Всё остальное: человеческий текст + код обращения, а подробности уходят
 *   только в серверный журнал.
 */
export function actionFailure(operation: string, err: unknown, fallback?: string): ActionResult {
  if (err === null || err === undefined) {
    return { ok: false, code: 'failed', error: fallback ?? GENERIC_FAILURE };
  }
  const classified = classifyError(err, fallback ?? GENERIC_FAILURE);
  if (classified.business) {
    return { ok: false, code: classified.code, error: classified.message };
  }
  const supportId = newSupportId();
  logActionFailure(
    {
      supportId,
      operation,
      code: classified.code,
      sqlstate: classified.sqlstate,
      errorName: classified.errorName,
    },
    err,
  );
  return {
    ok: false,
    code: classified.code,
    error: `${withPeriod(classified.message)} Код обращения: ${supportId}.`,
    supportId,
  };
}

/**
 * Для вспомогательных функций, которые возвращают текст ошибки строкой
 * (`string | null`), а не `ActionResult`: тот же безопасный путь с кодом
 * обращения, но без обёртки. Сырой текст базы наружу не уходит.
 */
export function failureText(operation: string, err: unknown, fallback?: string): string {
  return actionFailure(operation, err, fallback).error ?? GENERIC_FAILURE;
}

/**
 * Ошибки Supabase Auth. Часть из них человек должен увидеть, чтобы исправить
 * ввод («пароль совпадает со старым»), — их GoTrue отдаёт кодом. Известные коды
 * получают русский текст, остальное идёт безопасным путём.
 */
const AUTH_MESSAGE: Record<string, string> = {
  same_password: 'Новый пароль должен отличаться от прежнего.',
  weak_password: 'Пароль слишком простой. Используйте не менее 8 символов, буквы и цифры.',
  over_email_send_rate_limit: 'Слишком много писем за короткое время. Повторите через минуту.',
  over_request_rate_limit: 'Слишком много попыток. Повторите через минуту.',
  email_address_invalid: 'Проверьте адрес электронной почты.',
  validation_failed: 'Проверьте введённые данные.',
};

export function authErrorText(operation: string, err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && AUTH_MESSAGE[code]) return AUTH_MESSAGE[code];
  return failureText(operation, err);
}
