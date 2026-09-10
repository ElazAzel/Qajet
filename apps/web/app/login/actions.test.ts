import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ profile: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { signInWithPassword: mocks.signIn, signOut: mocks.signOut },
    from: () => ({ select: () => ({ eq: () => ({ single: mocks.profile }) }) }),
  }),
}));

import { signIn } from './actions';

function form() {
  const data = new FormData();
  data.set('email', 'test@example.com');
  data.set('password', 'password');
  return data;
}
describe('signIn profile gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signIn.mockResolvedValue({ data: { user: { id: 'u' } }, error: null });
    mocks.signOut.mockResolvedValue({ error: null });
  });
  it.each([
    null,
    { role: 'admin', is_active: false },
    { role: 'owner', is_active: true, companies: null },
  ])('показывает ошибку и завершает сессию для недоступного профиля: %j', async (profile) => {
    mocks.profile.mockResolvedValue({ data: profile });
    expect(await signIn(null, form())).toBeTruthy();
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });
  it('открывает кабинет активного поставщика', async () => {
    mocks.profile.mockResolvedValue({
      data: { role: 'owner', is_active: true, companies: { type: 'supplier' } },
    });
    await expect(signIn(null, form())).rejects.toThrow('redirect:/supplier');
  });
});
