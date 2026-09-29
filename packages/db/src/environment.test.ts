import { describe, expect, it } from 'vitest';
import {
  assertDemoDataAllowed,
  CLIENT_ENVIRONMENT,
  isLocalDatabaseUrl,
  validateRequisites,
} from './environment';

const VALID = {
  legalName: 'ТОО "Кажет"',
  bin: '210140012345',
  address: 'г. Алматы, пр. Абая 1',
  bankName: 'АО "Halyk Bank"',
  // Контрольная сумма посчитана по ISO 13616 (mod 97).
  iban: 'KZ86125KZT5004100100',
  bik: 'HSBKKZKX',
  phone: '+7 701 000 00 00',
  email: 'billing@example.kz',
};

describe('validateRequisites', () => {
  it('принимает корректные реквизиты и нормализует IBAN', () => {
    const result = validateRequisites({ ...VALID, iban: 'kz86 125k zt50 0410 0100' });
    expect(result).toEqual({ ok: true, value: VALID });
  });

  it('отвергает IBAN с ошибкой в одной цифре (контрольная сумма)', () => {
    const result = validateRequisites({ ...VALID, iban: 'KZ86125KZT5004100101' });
    expect(result.ok).toBe(false);
  });

  it('отвергает демо-реквизиты из сида — они выдуманы', () => {
    const result = validateRequisites({
      ...VALID,
      bin: '241140012345',
      iban: 'KZ123456789012345678',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/демо/i);
  });

  it.each([
    ['bin', '12345'],
    ['bik', 'HSBK'],
    ['email', 'не почта'],
    ['legalName', '  '],
  ])('отвергает некорректное поле %s', (field, value) => {
    expect(validateRequisites({ ...VALID, [field]: value }).ok).toBe(false);
  });

  it('отвергает не-объект', () => {
    expect(validateRequisites(null).ok).toBe(false);
  });
});

describe('isLocalDatabaseUrl', () => {
  it.each([
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    'postgres://u:p@localhost:5432/qajet',
    'postgres://u:p@[::1]:5432/qajet',
  ])('%s — локальная', (url) => expect(isLocalDatabaseUrl(url)).toBe(true));

  it.each([
    'postgresql://postgres.abc:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres',
    'postgres://u:p@db.eoqcktgvnzayyinulbch.supabase.co:5432/postgres',
    'не url',
  ])('%s — не локальная', (url) => expect(isLocalDatabaseUrl(url)).toBe(false));
});

describe('assertDemoDataAllowed', () => {
  it('пропускает демо- и неразмеченную базу', () => {
    expect(() => assertDemoDataAllowed(undefined, 'db:reset')).not.toThrow();
    expect(() => assertDemoDataAllowed('demo', 'db:reset')).not.toThrow();
  });

  it('запрещает демо-операцию в клиентском окружении', () => {
    expect(() => assertDemoDataAllowed(CLIENT_ENVIRONMENT, 'db:reset')).toThrow(/клиентск/);
  });
});
