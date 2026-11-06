import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  from: vi.fn(),
  grant: vi.fn(),
  stat: vi.fn(),
  remove: vi.fn(),
  intent: vi.fn(),
  insert: vi.fn(),
  visible: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('redirect');
  },
}));
vi.mock('../current-user', () => ({
  requireCurrentUser: async () => ({ id: 'user' }),
  orderActorFor: mocks.actor,
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ from: mocks.from }),
}));
vi.mock('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => ({}) }));
vi.mock('../signed-link', () => ({
  createSignedLink: () => 'signed',
  verifySignedLink: mocks.intent,
}));
vi.mock('../storage/adapter', async (original) => ({
  ...(await original<typeof import('../storage/adapter')>()),
  SupabaseStorageAdapter: class {
    createUploadGrant = mocks.grant;
    stat = mocks.stat;
    delete = mocks.remove;
  },
}));

import { finishAttachmentUpload, prepareAttachmentUpload } from './attachment-actions';

const orderId = '00000000-0000-4000-8000-000000000001';
const input = { orderId, fileName: 'invoice.pdf', contentType: 'application/pdf', sizeBytes: 20 };

describe('attachment upload authorization and retry safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor.mockReturnValue('supplier');
    mocks.visible.mockResolvedValue({ data: { id: orderId }, error: null });
    mocks.from.mockImplementation((table: string) => {
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle:
          table === 'plan_lines'
            ? async () => ({ data: null, error: { code: 'PGRST200' } })
            : mocks.visible,
        insert: mocks.insert,
      };
      return query;
    });
    mocks.grant.mockResolvedValue({ path: 'user/file.pdf', token: 'upload-token' });
    mocks.stat.mockResolvedValue({ size: 20, contentType: 'application/pdf' });
    mocks.intent.mockReturnValue({
      userId: 'user',
      objectKey: 'user/file.pdf',
      context: { orderId },
      kind: 'supplier_invoice',
      fileName: 'invoice.pdf',
    });
    mocks.insert.mockResolvedValue({ error: null });
    mocks.remove.mockResolvedValue(undefined);
  });

  it('issues a grant for a supplier order visible under RLS without a nonexistent direct plan-line join', async () => {
    expect(await prepareAttachmentUpload(input)).toMatchObject({ ok: true });
    expect(mocks.grant).toHaveBeenCalledOnce();
  });

  it('does not issue a grant when the order is hidden by RLS', async () => {
    mocks.visible.mockResolvedValue({ data: null, error: null });
    expect(await prepareAttachmentUpload(input)).toMatchObject({ ok: false });
    expect(mocks.grant).not.toHaveBeenCalled();
  });

  it('rejects multiple parent contexts before issuing an upload grant', async () => {
    expect(await prepareAttachmentUpload({ ...input, threadId: orderId })).toMatchObject({
      ok: false,
    });
    expect(mocks.grant).not.toHaveBeenCalled();
  });

  it('does not delete a previously saved file when a retry gets an uncertain database error', async () => {
    mocks.actor.mockReturnValue('concierge');
    mocks.insert.mockResolvedValue({ error: { code: '08006', message: 'connection lost' } });
    expect(await finishAttachmentUpload('signed', '/buyer/messages')).toMatchObject({ ok: false });
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
