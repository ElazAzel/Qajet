export interface InviteTeamMemberInput {
  email: string;
  fullName: string;
  approvalLimitKzt?: number | null | undefined;
}

export interface NormalizedInviteTeamMemberInput {
  email: string;
  fullName: string;
  approvalLimitKzt: number | null;
}

export function normalizeInviteTeamMemberInput(
  input: InviteTeamMemberInput,
): NormalizedInviteTeamMemberInput | string {
  if (!input || typeof input.email !== 'string' || typeof input.fullName !== 'string') {
    return 'Укажите имя и email сотрудника';
  }
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim().replace(/\s+/g, ' ');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Укажите корректный email';
  if (fullName.length < 2 || fullName.length > 120) {
    return 'Имя должно быть длиной от 2 до 120 символов';
  }
  const limit = input.approvalLimitKzt ?? null;
  if (limit !== null && (!Number.isSafeInteger(limit) || limit < 0)) {
    return 'Лимит должен быть целым неотрицательным числом';
  }
  return { email, fullName, approvalLimitKzt: limit };
}
