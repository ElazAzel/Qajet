import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EDITABLE_SETTINGS } from '../settings-catalog';

const mocks = vi.hoisted(() => ({ user: vi.fn(), update: vi.fn(), eq: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../current-user', () => ({ requireCurrentUser: mocks.user }));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    from: () => ({ update: mocks.update }),
  }),
}));

import { updateSetting } from './settings-actions';

describe('commission settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: 'admin', role: 'admin' });
    mocks.update.mockReturnValue({ eq: mocks.eq });
    mocks.eq.mockResolvedValue({ error: null });
  });

  it('shows the same 10–15% limits as the pricing engine', () => {
    expect(
      EDITABLE_SETTINGS.find((setting) => setting.key === 'commission_rate_pct'),
    ).toMatchObject({
      min: 10,
      max: 15,
      hint: expect.stringContaining('10-15%'),
    });
  });

  it.each([10, 12.5, 15])('allows an admin to save %s%%', async (value) => {
    expect(await updateSetting('commission_rate_pct', value)).toEqual({ ok: true });
    expect(mocks.update).toHaveBeenCalledWith({ value, updated_at: expect.any(String) });
    expect(mocks.eq).toHaveBeenCalledWith('key', 'commission_rate_pct');
  });

  it.each([9.99, 15.01, 21, 23, 24, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects %s before writing to the database',
    async (value) => {
      expect(await updateSetting('commission_rate_pct', value)).toMatchObject({ ok: false });
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );

  it('does not let non-admins edit the rate', async () => {
    mocks.user.mockResolvedValue({ id: 'concierge', role: 'concierge' });
    expect(await updateSetting('commission_rate_pct', 15)).toMatchObject({ ok: false });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
