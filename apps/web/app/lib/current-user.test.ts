import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  profile: vi.fn(),
  contact: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock('@qajet/pd', () => ({ createPdClient: () => ({ getUserContact: mocks.contact }) }));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.profile }) }) }),
  }),
}));

import { requireCurrentUser } from './current-user';

describe('requireCurrentUser', () => {
  beforeEach(() => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user' } } });
    mocks.contact.mockResolvedValue({ id: 'user', fullName: 'Test', email: 'test@example.com' });
  });
  it('отклоняет деактивированного сотрудника с ещё действующей auth-сессией', async () => {
    mocks.profile.mockResolvedValue({
      data: { role: 'admin', is_active: false, company_id: null, companies: null },
    });
    await expect(requireCurrentUser()).rejects.toThrow('redirect:/login');
  });
  it('не превращает профиль без компании в покупателя', async () => {
    mocks.profile.mockResolvedValue({
      data: { role: 'owner', is_active: true, company_id: null, companies: null },
    });
    await expect(requireCurrentUser()).rejects.toThrow('redirect:/login');
  });
  it('разрешает активного админа без компании', async () => {
    mocks.profile.mockResolvedValue({
      data: { role: 'admin', is_active: true, company_id: null, companies: null },
    });
    await expect(requireCurrentUser()).resolves.toMatchObject({ role: 'admin' });
  });
});
