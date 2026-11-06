import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({ select: () => ({ limit: mocks.read, in: mocks.read }) }),
  }),
}));

import { GET } from './route';

const requisites = {
  legalName: 'E2E operator',
  bin: '210140012345',
  address: 'E2E address',
  bankName: 'E2E bank',
  iban: 'KZ86125KZT5004100100',
  bik: 'HSBKKZKX',
  phone: '+77010000000',
  email: 'billing@example.test',
};
const settings = [
  { key: 'environment_kind', value: 'clients' },
  { key: 'qajet_requisites', value: requisites },
];
describe('client runtime readiness', () => {
  beforeEach(() => {
    for (const key of [
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'NEXT_PUBLIC_SITE_URL',
      'LINK_SIGNING_SECRET',
      'CRON_SECRET',
      'RESEND_API_KEY',
      'RESEND_FROM_EMAIL',
    ])
      vi.stubEnv(key, 'E2E-test-only');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', undefined);
    vi.stubEnv('GIT_COMMIT_SHA', 'a'.repeat(40));
    mocks.read.mockResolvedValue({ data: settings, error: null });
  });
  it('rejects a reachable but empty settings table', async () => {
    mocks.read.mockResolvedValue({ data: [], error: null });
    expect((await GET()).status).toBe(503);
  });
  it('rejects demo configuration', async () => {
    mocks.read.mockResolvedValue({
      data: [{ key: 'environment_kind', value: 'demo' }, settings[1]],
      error: null,
    });
    expect((await GET()).status).toBe(503);
  });
  it('rejects invalid operator requisites', async () => {
    mocks.read.mockResolvedValue({
      data: [settings[0], { key: 'qajet_requisites', value: { ...requisites, iban: 'KZ-broken' } }],
      error: null,
    });
    expect((await GET()).status).toBe(503);
  });
  it('rejects missing cron or mail configuration in the actual runtime', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await GET()).status).toBe(503);
    vi.stubEnv('CRON_SECRET', 'E2E-test-only');
    vi.stubEnv('RESEND_API_KEY', '');
    expect((await GET()).status).toBe(503);
  });
  it('returns a safe dependency failure without provider detail', async () => {
    mocks.read.mockResolvedValue({ data: null, error: { message: 'private database detail' } });
    const result = await GET();
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain('private database detail');
  });
  it('accepts a configured client runtime without claiming external release checks', async () => {
    const result = await GET();
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      ok: true,
      dependency: 'supabase',
      commit: 'a'.repeat(40),
    });
  });
});
