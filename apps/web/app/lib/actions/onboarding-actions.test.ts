import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  createAdmin: vi.fn(),
  createServer: vi.fn(),
  revalidate: vi.fn(),
  logFailure: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('../current-user', () => ({
  requireCurrentUser: mocks.currentUser,
  orderActorFor: (user: { role: string }) => user.role,
}));
vi.mock('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: mocks.createAdmin }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: mocks.createServer }));
vi.mock('../server-log', () => ({ logActionFailure: mocks.logFailure }));

import { type CompanyInput, createCompanyWithOwner, resendOwnerInvite } from './company-actions';
import { inviteTeamMember } from './team-actions';

const companyId = '10000000-0000-4000-8000-000000000001';
const ownerId = '10000000-0000-4000-8000-000000000002';
const input: CompanyInput = {
  type: 'buyer',
  name: 'E2E-local-onboarding-company',
  bin: '000000000001',
  city: 'E2E Test City',
  ownerEmail: 'e2e-owner@example.invalid',
  ownerFullName: 'E2E Test Owner',
};
const managerInput = {
  email: '  E2E-MANAGER@EXAMPLE.INVALID ',
  fullName: ' E2E   Test Manager ',
  approvalLimitKzt: 0,
};
const privateError = { message: 'E2E-private-provider-detail', code: 'XX000' };

type Row = Record<string, unknown>;
type Operation = { table: string; kind: string; value?: Row; filters: Array<[string, unknown]> };

// An in-memory action transport, not a database or an RLS emulator.
function serviceFixture(fail?: string) {
  const operations: Operation[] = [];
  const invite = vi.fn().mockResolvedValue({ data: { user: { id: ownerId } }, error: null });
  const removeUser = vi.fn().mockResolvedValue({ error: null });
  const link = vi.fn().mockResolvedValue({
    data: { properties: { action_link: 'http://localhost:54321/E2E-invite' } },
    error: null,
  });
  const from = vi.fn((table: string) => {
    const op: Operation = { table, kind: '', filters: [] };
    function result() {
      operations.push(op);
      if (`${table}.${op.kind}` === fail) return { data: null, error: privateError };
      if (table === 'companies' && op.kind === 'insert')
        return { data: { id: companyId }, error: null };
      if (table === 'users' && op.kind === 'select') {
        return {
          data: { id: ownerId, email: input.ownerEmail, companies: { name: input.name } },
          error: null,
        };
      }
      return { data: null, error: null };
    }
    const query = {
      insert(value: Row) {
        op.kind = 'insert';
        op.value = value;
        return query;
      },
      delete() {
        op.kind = 'delete';
        return query;
      },
      select() {
        op.kind ||= 'select';
        return query;
      },
      eq(key: string, value: unknown) {
        op.filters.push([key, value]);
        return query;
      },
      single: async () => result(),
      maybeSingle: async () => result(),
      // biome-ignore lint/suspicious/noThenProperty: emulate the awaited PostgREST builder.
      then(resolve: (value: unknown) => unknown) {
        return Promise.resolve(result()).then(resolve);
      },
    };
    return query;
  });
  mocks.createAdmin.mockReturnValue({
    from,
    auth: { admin: { inviteUserByEmail: invite, deleteUser: removeUser, generateLink: link } },
  });
  return { operations, invite, removeUser, link, from };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Unexpected network request');
    }),
  );
  mocks.currentUser.mockResolvedValue({
    id: 'E2E-local-admin',
    role: 'admin',
    companyId: null,
    companyType: null,
  });
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('company and first owner onboarding', () => {
  it.each(['owner', 'manager', 'concierge'])(
    'rejects %s before creating a privileged client',
    async (role) => {
      mocks.currentUser.mockResolvedValue({ role, companyId, companyType: 'buyer' });
      expect(await createCompanyWithOwner(input)).toMatchObject({ ok: false });
      expect(mocks.createAdmin).not.toHaveBeenCalled();
    },
  );

  it('stops when the session/profile gate rejects', async () => {
    mocks.currentUser.mockRejectedValue(new Error('redirect:/login'));
    await expect(createCompanyWithOwner(input)).rejects.toThrow('redirect:/login');
    expect(mocks.createAdmin).not.toHaveBeenCalled();
  });

  it.each([
    { bin: 'bad' },
    { ownerEmail: 'bad' },
    { name: ' ' },
    { type: 'admin' },
    { role: 'admin' },
    { company_id: companyId },
  ])('rejects invalid or injected company fields: %j', async (changed) => {
    expect(await createCompanyWithOwner({ ...input, ...changed } as CompanyInput)).toMatchObject({
      ok: false,
    });
    expect(mocks.createAdmin).not.toHaveBeenCalled();
  });

  it.each(['buyer', 'supplier'] as const)(
    'creates the %s company and owner with server-owned role and IDs',
    async (type) => {
      const f = serviceFixture();
      expect(await createCompanyWithOwner({ ...input, type })).toEqual({ ok: true });
      expect(f.invite).toHaveBeenCalledExactlyOnceWith(input.ownerEmail, {
        data: {
          full_name: input.ownerFullName,
          company_id: companyId,
          company_type: type,
          role: 'owner',
        },
      });
      expect(f.operations[0]).toMatchObject({
        table: 'companies',
        kind: 'insert',
        value: {
          type,
          name: input.name,
          bin: input.bin,
          city: input.city,
          is_active: true,
        },
      });
      expect(f.operations[1]).toMatchObject({
        table: 'users',
        kind: 'insert',
        value: {
          id: ownerId,
          company_id: companyId,
          email: input.ownerEmail,
          full_name: input.ownerFullName,
          role: 'owner',
          is_active: true,
        },
      });
      expect(f.operations.map((op) => op.table)).toEqual(
        type === 'supplier' ? ['companies', 'users', 'supplier_profiles'] : ['companies', 'users'],
      );
      expect(f.removeUser).not.toHaveBeenCalled();
      expect(mocks.revalidate.mock.calls).toEqual([['/admin'], ['/admin/companies']]);
    },
  );

  it('returns a safe error when the Admin API is unavailable', async () => {
    mocks.createAdmin.mockImplementation(() => {
      throw new Error(privateError.message);
    });
    const result = await createCompanyWithOwner(input);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(privateError.message);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it('does not send an invitation when company creation fails', async () => {
    const f = serviceFixture('companies.insert');
    const result = await createCompanyWithOwner(input);
    expect(result.ok).toBe(false);
    expect(f.invite).not.toHaveBeenCalled();
    expect(f.removeUser).not.toHaveBeenCalled();
    expect(f.operations).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(privateError.message);
  });

  it('removes only the created company when the invitation fails', async () => {
    const f = serviceFixture();
    f.invite.mockResolvedValue({ data: { user: null }, error: privateError });
    expect(await createCompanyWithOwner(input)).toMatchObject({ ok: false });
    expect(f.operations).toHaveLength(2);
    expect(f.operations[1]).toMatchObject({
      table: 'companies',
      kind: 'delete',
      filters: [['id', companyId]],
    });
    expect(f.removeUser).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it('compensates only the new Auth identity/company when owner profile insertion fails', async () => {
    const f = serviceFixture('users.insert');
    const result = await createCompanyWithOwner(input);
    expect(result.ok).toBe(false);
    expect(f.removeUser).toHaveBeenCalledExactlyOnceWith(ownerId);
    expect(f.operations.at(-1)).toMatchObject({
      table: 'companies',
      kind: 'delete',
      filters: [['id', companyId]],
    });
    expect(JSON.stringify(result)).not.toContain(privateError.message);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it('compensates the synthetic supplier identity/profile/company on supplier setup failure', async () => {
    const f = serviceFixture('supplier_profiles.insert');
    expect(await createCompanyWithOwner({ ...input, type: 'supplier' })).toMatchObject({
      ok: false,
    });
    expect(f.removeUser).toHaveBeenCalledExactlyOnceWith(ownerId);
    expect(f.operations.filter((op) => op.kind === 'delete')).toEqual([
      { table: 'users', kind: 'delete', filters: [['id', ownerId]] },
      { table: 'companies', kind: 'delete', filters: [['id', companyId]] },
    ]);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});

describe('team invitation onboarding', () => {
  it.each(['admin', 'concierge', 'manager'])(
    'rejects %s before using service access',
    async (role) => {
      mocks.currentUser.mockResolvedValue({ role, companyId, companyType: 'buyer' });
      expect(await inviteTeamMember(managerInput)).toMatchObject({ ok: false });
      expect(mocks.createAdmin).not.toHaveBeenCalled();
    },
  );

  it.each(['buyer', 'supplier'] as const)(
    'derives %s manager company/role from the owner session, not extra client fields',
    async (companyType) => {
      mocks.currentUser.mockResolvedValue({ role: 'owner', companyId, companyType });
      const f = serviceFixture();
      const forgedInput = { ...managerInput, company_id: 'E2E-foreign-company', role: 'admin' };
      expect(await inviteTeamMember(forgedInput)).toEqual({ ok: true });
      expect(f.invite).toHaveBeenCalledExactlyOnceWith('e2e-manager@example.invalid', {
        data: {
          full_name: 'E2E Test Manager',
          company_id: companyId,
          role: 'manager',
          company_type: companyType,
        },
      });
      expect(f.operations[0]).toMatchObject({
        table: 'users',
        kind: 'insert',
        value: {
          id: ownerId,
          company_id: companyId,
          email: 'e2e-manager@example.invalid',
          full_name: 'E2E Test Manager',
          role: 'manager',
          approval_limit_kzt: 0,
          is_active: true,
        },
      });
      expect(mocks.createServer).not.toHaveBeenCalled();
      expect(mocks.revalidate.mock.calls).toEqual([['/buyer/team'], ['/supplier/team']]);
    },
  );

  it.each([null, undefined])('rejects an owner without a company (%j)', async (missing) => {
    mocks.currentUser.mockResolvedValue({
      role: 'owner',
      companyId: missing,
      companyType: 'buyer',
    });
    expect(await inviteTeamMember(managerInput)).toMatchObject({ ok: false });
    expect(mocks.createAdmin).not.toHaveBeenCalled();
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])(
    'rejects invalid approval limit %s before inviting',
    async (approvalLimitKzt) => {
      mocks.currentUser.mockResolvedValue({ role: 'owner', companyId, companyType: 'buyer' });
      expect(await inviteTeamMember({ ...managerInput, approvalLimitKzt })).toMatchObject({
        ok: false,
      });
      expect(mocks.createAdmin).not.toHaveBeenCalled();
    },
  );

  it('does not create a public manager profile on invitation failure', async () => {
    mocks.currentUser.mockResolvedValue({ role: 'owner', companyId, companyType: 'buyer' });
    const f = serviceFixture();
    f.invite.mockResolvedValue({ data: { user: null }, error: privateError });
    expect(await inviteTeamMember(managerInput)).toMatchObject({ ok: false });
    expect(f.from).not.toHaveBeenCalled();
    expect(f.removeUser).not.toHaveBeenCalled();
  });

  it('compensates only the newly invited identity when manager profile creation fails', async () => {
    mocks.currentUser.mockResolvedValue({ role: 'owner', companyId, companyType: 'supplier' });
    const f = serviceFixture('users.insert');
    const result = await inviteTeamMember(managerInput);
    expect(result.ok).toBe(false);
    expect(f.removeUser).toHaveBeenCalledExactlyOnceWith(ownerId);
    expect(f.operations).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(privateError.message);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});

describe('owner invitation resend', () => {
  it('rejects a non-admin and a malformed owner ID before creating a client', async () => {
    mocks.currentUser.mockResolvedValueOnce({ role: 'owner' });
    expect(await resendOwnerInvite(ownerId)).toMatchObject({ ok: false });
    expect(await resendOwnerInvite('bad')).toMatchObject({ ok: false });
    expect(mocks.createAdmin).not.toHaveBeenCalled();
  });

  it('queues a fresh link without creating another user or sending mail from the action', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000/');
    const f = serviceFixture();
    expect(await resendOwnerInvite(ownerId)).toEqual({ ok: true });
    expect(f.operations[0]?.filters).toEqual([
      ['id', ownerId],
      ['role', 'owner'],
    ]);
    expect(f.link).toHaveBeenCalledExactlyOnceWith({
      type: 'invite',
      email: input.ownerEmail,
      options: {
        redirectTo: 'http://localhost:3000/auth/confirm?next=%2Fauth%2Fset-password',
      },
    });
    expect(f.operations[1]).toMatchObject({
      table: 'outbox',
      kind: 'insert',
      value: {
        kind: 'company_owner_invite',
        recipient: input.ownerEmail,
        status: 'pending',
        payload: { userId: ownerId, actionLink: 'http://localhost:54321/E2E-invite' },
      },
    });
    expect(f.invite).not.toHaveBeenCalled();
    expect(f.removeUser).not.toHaveBeenCalled();
  });

  it('does not queue a message when Auth cannot generate the link', async () => {
    const f = serviceFixture();
    f.link.mockResolvedValue({ data: { properties: null }, error: privateError });
    const result = await resendOwnerInvite(ownerId);
    expect(result.ok).toBe(false);
    expect(f.operations).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(privateError.message);
  });

  it('reports queue failure safely without pretending the invitation was sent', async () => {
    const f = serviceFixture('outbox.insert');
    const result = await resendOwnerInvite(ownerId);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(privateError.message);
    expect(f.invite).not.toHaveBeenCalled();
  });
});
