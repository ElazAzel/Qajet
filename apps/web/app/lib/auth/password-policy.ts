import { isPasswordPwned } from './pwned-password';

/**
 * Единственное место, где решается, годится ли пароль.
 *
 * Модуль намеренно отдельный, без `'use server'`: в файле серверных действий
 * КАЖДЫЙ экспорт становится вызываемым из браузера. Экспортированная отсюда
 * проверка была бы бесплатным оракулом «есть ли такой пароль в утечках».
 */
export const MIN_PASSWORD_LENGTH = 8;

export const PWNED_PASSWORD_MESSAGE =
  'Этот пароль встречается в известных утечках паролей. Придумайте другой — его уже перебирают.';

/**
 * Возвращает текст ошибки для человека или null, если пароль годится.
 *
 * Дешёвые проверки идут первыми: короткий пароль и опечатка в подтверждении
 * не должны стоить сетевого запроса. Проверка утечек — последняя и
 * необязательная: её отказ не запрещает пароль (см. pwned-password.ts).
 */
export async function validatePasswordPolicy(
  password: string,
  confirmation: string,
): Promise<string | null> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Пароль должен содержать минимум ${MIN_PASSWORD_LENGTH} символов.`;
  }
  if (password !== confirmation) return 'Пароли не совпадают.';

  try {
    if (await isPasswordPwned(password)) return PWNED_PASSWORD_MESSAGE;
  } catch {
    // Проверка необязательная: непредвиденный сбой не запирает человека.
  }
  return null;
}
