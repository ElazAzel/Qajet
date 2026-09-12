import { describe, expect, it } from 'vitest';
import { normalizeInviteTeamMemberInput } from './team-invitation';

describe('team invitation input', () => {
  it('normalizes email/name and keeps an empty limit nullable', () => {
    expect(
      normalizeInviteTeamMemberInput({
        email: '  ALIYA@Example.KZ ',
        fullName: '  Алия   Садыкова ',
        approvalLimitKzt: null,
      }),
    ).toEqual({ email: 'aliya@example.kz', fullName: 'Алия Садыкова', approvalLimitKzt: null });
  });

  it.each([
    [{ email: 'bad', fullName: 'Алия' }, 'Укажите корректный email'],
    [{ email: 'a@example.kz', fullName: 'А' }, 'Имя должно быть длиной от 2 до 120 символов'],
    [
      { email: 'a@example.kz', fullName: 'Алия', approvalLimitKzt: 1.5 },
      'Лимит должен быть целым неотрицательным числом',
    ],
  ])('rejects invalid input: %j', (input, message) => {
    expect(normalizeInviteTeamMemberInput(input)).toBe(message);
  });
});
