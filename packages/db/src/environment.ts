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

export interface QajetRequisites {
  legalName: string;
  bin: string;
  address: string;
  bankName: string;
  iban: string;
  bik: string;
  phone: string;
  email: string;
}

/** Демо-значения из сида (generator.ts). Документ клиенту с ними — это чужой счёт. */
const DEMO_BIN = '241140012345';
const DEMO_IBAN = 'KZ123456789012345678';

function ibanChecksumValid(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const digits = Number.parseInt(char, 36).toString();
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/**
 * Реквизиты QAJET попадают в каждый счёт и акт (Document Engine), поэтому
 * клиентское окружение не поднимается без проверенных настоящих значений.
 */
export function validateRequisites(
  input: unknown,
): { ok: true; value: QajetRequisites } | { ok: false; errors: string[] } {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, errors: ['Реквизиты должны быть JSON-объектом'] };
  }
  const raw = input as Record<string, unknown>;
  const text = (key: keyof QajetRequisites) =>
    typeof raw[key] === 'string' ? (raw[key] as string).trim() : '';
  const value: QajetRequisites = {
    legalName: text('legalName'),
    bin: text('bin'),
    address: text('address'),
    bankName: text('bankName'),
    iban: text('iban').replace(/\s+/g, '').toUpperCase(),
    bik: text('bik').toUpperCase(),
    phone: text('phone'),
    email: text('email'),
  };

  const errors: string[] = [];
  for (const key of ['legalName', 'address', 'bankName', 'phone'] as const) {
    if (!value[key]) errors.push(`Поле ${key} пустое`);
  }
  if (!/^\d{12}$/.test(value.bin)) errors.push('БИН — ровно 12 цифр');
  if (!/^KZ\d{2}[A-Z0-9]{16}$/.test(value.iban) || !ibanChecksumValid(value.iban)) {
    errors.push('IBAN не проходит проверку (формат KZ + 18 знаков, контрольная сумма)');
  }
  if (!/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(value.bik)) errors.push('БИК — 8 или 11 знаков');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) errors.push('Почта указана некорректно');
  if (value.bin === DEMO_BIN || value.iban === DEMO_IBAN) {
    errors.push('Это демо-реквизиты из сида, а не реальное юрлицо');
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}
