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
