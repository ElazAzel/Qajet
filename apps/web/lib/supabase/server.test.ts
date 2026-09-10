import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), set: vi.fn() }));
vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.create }));
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: mocks.set }) }));

import { createSupabaseServerClient } from './server';

describe('Supabase cookie adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('не роняет Server Component, когда cookie доступны только для чтения', async () => {
    mocks.set.mockImplementation(() => {
      throw new Error('Cookies can only be modified in a Server Action or Route Handler');
    });
    await createSupabaseServerClient();
    const options = mocks.create.mock.calls[0]?.[2];
    expect(() =>
      options.cookies.setAll([{ name: 'sb-token', value: 'refreshed', options: {} }]),
    ).not.toThrow();
  });
  it('сохраняет cookies в Server Action', async () => {
    mocks.set.mockImplementation(() => {});
    await createSupabaseServerClient();
    const options = mocks.create.mock.calls[0]?.[2];
    options.cookies.setAll([{ name: 'sb-token', value: 'new', options: { httpOnly: true } }]);
    expect(mocks.set).toHaveBeenCalledWith('sb-token', 'new', { httpOnly: true });
  });
});
