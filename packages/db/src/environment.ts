/**
 * Демо и клиенты — разные окружения. Демо-база держит пять аккаунтов с паролем
 * из репозитория (в том числе admin и concierge, которые видят данные всех
 * компаний) и шестнадцать выдуманных поставщиков в пуле подбора: реальный
 * RFQ клиента ушёл бы им. Клиентское окружение помечается строкой settings и
 * не принимает ни демо-сид, ни сброс — снять метку можно только руками в SQL.
 */

export const ENVIRONMENT_KIND_KEY = 'environment_kind';
export const CLIENT_ENVIRONMENT = 'clients';

export function assertDemoDataAllowed(environmentKind: unknown, operation: string): void {
  if (environmentKind === CLIENT_ENVIRONMENT) {
    throw new Error(
      `${operation}: это клиентское окружение (settings.${ENVIRONMENT_KIND_KEY} = '${CLIENT_ENVIRONMENT}'). ` +
        'Демо-сид и сброс здесь запрещены: они удалили бы данные клиентов и завели бы демо-аккаунты с паролем из репозитория.',
    );
  }
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** Локальная ли база — по хосту URL, а не по NODE_ENV, который из консоли не выставляется. */
export function isLocalDatabaseUrl(databaseUrl: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(databaseUrl).hostname);
  } catch {
    return false;
  }
}

export { type QajetRequisites, validateRequisites } from '@qajet/engine/client-requisites';
