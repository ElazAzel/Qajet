import { afterEach, describe, expect, it, vi } from 'vitest';
import { MIN_PASSWORD_LENGTH, validatePasswordPolicy } from './password-policy';

/**
 * Политика пароля целиком, включая проверку по базе утечек.
 *
 * Порядок проверок важен и закреплён тестами: короткий пароль и несовпадение
 * отсеиваются ДО обращения к внешнему сервису. Иначе каждая опечатка в
 * подтверждении уходила бы запросом наружу и замедляла форму.
 */

vi.mock('./pwned-password', () => ({ isPasswordPwned: vi.fn(async () => false) }));
const { isPasswordPwned } = await import('./pwned-password');
const pwned = vi.mocked(isPasswordPwned);

afterEach(() => {
  pwned.mockReset();
  pwned.mockResolvedValue(false);
});

describe('validatePasswordPolicy', () => {
  it('короткий пароль отклоняется, и утечки не запрашиваются', async () => {
    expect(await validatePasswordPolicy('short', 'short')).toMatch(
      new RegExp(String(MIN_PASSWORD_LENGTH)),
    );
    expect(pwned).not.toHaveBeenCalled();
  });

  it('несовпадение подтверждения отклоняется до запроса утечек', async () => {
    expect(await validatePasswordPolicy('correct horse battery', 'correct horse batterz')).toBe(
      'Пароли не совпадают.',
    );
    expect(pwned).not.toHaveBeenCalled();
  });

  it('пароль из утечки отклоняется с внятной причиной', async () => {
    pwned.mockResolvedValue(true);
    const error = await validatePasswordPolicy('Password123', 'Password123');
    expect(error).toBeTruthy();
    expect(error).toMatch(/утечк/i);
    // Человеку говорят, что делать, а не только что он неправ.
    expect(error).toMatch(/друг|новый|измен/i);
  });

  it('годный пароль проходит', async () => {
    expect(
      await validatePasswordPolicy('correct horse battery', 'correct horse battery'),
    ).toBeNull();
    expect(pwned).toHaveBeenCalledWith('correct horse battery');
  });

  it('недоступность сервиса утечек не мешает установить пароль', async () => {
    pwned.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(
      await validatePasswordPolicy('correct horse battery', 'correct horse battery'),
    ).toBeNull();
  });
});
