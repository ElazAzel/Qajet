import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), send: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock('./email-adapter', () => ({ createEmailAdapter: () => ({ send: mocks.send }) }));

import { dispatchOutbox } from './dispatcher';

const SEND_ERROR = 'E2E-provider-rejected';
const RETRY_PRIVATE = 'E2E-private-retry-diagnostic@example.test';
const modes = ['error', 'false', 'null', 'reject', 'truthy'] as const;
type FailureMode = (typeof modes)[number];
const row = (id = 'E2E-outbox-first') => ({
  id,
  idempotency_key: `E2E-key-${id}`,
  recipient: 'E2E-controlled@example.test',
  subject: 'E2E-synthetic-subject',
  body: 'E2E-synthetic-body',
});

async function failedRpc(mode: FailureMode) {
  if (mode === 'reject') throw new Error(RETRY_PRIVATE);
  return {
    data: mode === 'error' ? true : mode === 'false' ? false : mode === 'truthy' ? 'true' : null,
    error: mode === 'error' ? { message: RETRY_PRIVATE } : null,
  };
}

function setup(rows = [row()]) {
  mocks.rpc.mockImplementation(async (name: string) => ({
    data: name === 'claim_outbox_batch' ? rows : true,
    error: null,
  }));
  mocks.send.mockResolvedValue({ providerMessageId: 'E2E-provider-id', transport: 'resend' });
}

function called(name: string) {
  return mocks.rpc.mock.calls.filter(([method]) => method === name);
}

beforeEach(() => {
  vi.resetAllMocks();
  // All sends and RPCs are isolated. Fail the test rather than reach a real provider.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected external fetch')));
  setup();
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe('outbox failure transition accounting', () => {
  it('reports zero unconfirmed retries for an empty batch', async () => {
    setup([]);
    expect(await dispatchOutbox()).toEqual({
      claimed: 0,
      sent: 0,
      failed: 0,
      retryUnconfirmed: 0,
      errors: [],
    });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('preserves the limit and lease for a successful batch without retrying', async () => {
    expect(await dispatchOutbox(7)).toEqual({
      claimed: 1,
      sent: 1,
      failed: 0,
      retryUnconfirmed: 0,
      errors: [],
    });
    const lease = called('claim_outbox_batch')[0]?.[1].p_lease_id;
    expect(lease).toEqual(expect.any(String));
    expect(called('claim_outbox_batch')).toEqual([
      ['claim_outbox_batch', { p_limit: 7, p_lease_id: lease }],
    ]);
    expect(called('complete_outbox')).toEqual([
      [
        'complete_outbox',
        { p_id: row().id, p_lease_id: lease, p_provider_message_id: 'E2E-provider-id' },
      ],
    ]);
    expect(called('fail_outbox')).toHaveLength(0);
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith({
      idempotencyKey: row().idempotency_key,
      recipient: row().recipient,
      subject: row().subject,
      body: row().body,
    });
  });

  it.each(['error', 'reject'])('does not start work after claim %s', async (mode) => {
    if (mode === 'reject') mocks.rpc.mockRejectedValue(new Error('E2E-claim-failed'));
    else mocks.rpc.mockResolvedValue({ data: null, error: { message: 'E2E-claim-failed' } });
    await expect(dispatchOutbox()).rejects.toThrow('E2E-claim-failed');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('counts a confirmed failure once and continues to the next row', async () => {
    setup([row(), row('E2E-outbox-next')]);
    mocks.send.mockRejectedValueOnce(new Error(SEND_ERROR));
    expect(await dispatchOutbox()).toEqual({
      claimed: 2,
      sent: 1,
      failed: 1,
      retryUnconfirmed: 0,
      errors: [`${row().id}: ${SEND_ERROR}`],
    });
    const lease = called('claim_outbox_batch')[0]?.[1].p_lease_id;
    expect(called('fail_outbox')).toEqual([
      ['fail_outbox', { p_id: row().id, p_lease_id: lease, p_error: SEND_ERROR }],
    ]);
    expect(called('complete_outbox')).toMatchObject([
      ['complete_outbox', { p_id: 'E2E-outbox-next', p_lease_id: lease }],
    ]);
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
  });

  it.each(modes)(
    'reports fail_outbox %s as unconfirmed and continues without retry',
    async (mode) => {
      const rows = [row(), row('E2E-outbox-next')];
      setup(rows);
      mocks.send.mockRejectedValueOnce(new Error(SEND_ERROR));
      mocks.rpc.mockImplementation(async (name: string) => {
        if (name === 'claim_outbox_batch') return { data: rows, error: null };
        if (name === 'fail_outbox') return failedRpc(mode);
        return { data: true, error: null };
      });

      const result = await dispatchOutbox();
      expect(result).toEqual({
        claimed: 2,
        sent: 1,
        failed: 1,
        retryUnconfirmed: 1,
        errors: [`${row().id}: ${SEND_ERROR}`, `${row().id}: outbox.retry_unconfirmed`],
      });
      expect(JSON.stringify(result)).not.toContain(RETRY_PRIVATE);
      expect(called('fail_outbox')).toHaveLength(1);
      expect(called('complete_outbox')).toMatchObject([
        ['complete_outbox', { p_id: 'E2E-outbox-next' }],
      ]);
      expect(mocks.send).toHaveBeenCalledTimes(2);
      expect(mocks.rpc).toHaveBeenCalledTimes(3);
    },
  );

  it.each(modes)(
    'does not count completion %s as sent or resend within the batch',
    async (mode) => {
      const rows = [row(), row('E2E-outbox-next')];
      setup(rows);
      mocks.rpc.mockImplementation(async (name: string, args: { p_id?: string }) => {
        if (name === 'claim_outbox_batch') return { data: rows, error: null };
        if (name === 'complete_outbox' && args.p_id === row().id) return failedRpc(mode);
        return { data: true, error: null };
      });

      const result = await dispatchOutbox();
      expect(result).toMatchObject({ claimed: 2, sent: 1, failed: 1, retryUnconfirmed: 0 });
      expect(called('complete_outbox')).toHaveLength(2);
      expect(called('fail_outbox')).toHaveLength(1);
      expect(mocks.send).toHaveBeenCalledTimes(2);
      expect(mocks.rpc).toHaveBeenCalledTimes(4);
    },
  );

  it('reports both uncertain completion and unconfirmed retry without abandoning the batch', async () => {
    const rows = [row(), row('E2E-outbox-next')];
    setup(rows);
    mocks.rpc.mockImplementation(async (name: string, args: { p_id?: string }) => {
      if (name === 'claim_outbox_batch') return { data: rows, error: null };
      if (name === 'complete_outbox' && args.p_id === row().id) return failedRpc('false');
      if (name === 'fail_outbox') return failedRpc('reject');
      return { data: true, error: null };
    });
    const result = await dispatchOutbox();
    expect(result).toMatchObject({ claimed: 2, sent: 1, failed: 1, retryUnconfirmed: 1 });
    expect(result.errors).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain(RETRY_PRIVATE);
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(called('fail_outbox')).toHaveLength(1);
  });

  it('counts each failed row and each unconfirmed transition once', async () => {
    const rows = [row(), row('E2E-outbox-next')];
    setup(rows);
    mocks.send.mockRejectedValue(new Error(SEND_ERROR));
    mocks.rpc.mockImplementation(async (name: string) =>
      name === 'claim_outbox_batch' ? { data: rows, error: null } : failedRpc('reject'),
    );
    const result = await dispatchOutbox();
    expect(result).toMatchObject({ claimed: 2, sent: 0, failed: 2, retryUnconfirmed: 2 });
    expect(result.errors).toHaveLength(4);
    expect(called('fail_outbox')).toHaveLength(2);
    expect(called('complete_outbox')).toHaveLength(0);
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });

  it('uses the same provider key and payload only when a later invocation claims the row again', async () => {
    mocks.send.mockRejectedValueOnce(new Error(SEND_ERROR));
    expect(await dispatchOutbox()).toMatchObject({ sent: 0, failed: 1, retryUnconfirmed: 0 });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    // The second claim is explicitly simulated, not an automatic retry or a
    // proof of provider deduplication or real database lease behavior.
    expect(await dispatchOutbox()).toMatchObject({ sent: 1, failed: 0, retryUnconfirmed: 0 });
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.send.mock.calls[1]).toEqual(mocks.send.mock.calls[0]);
    expect(called('claim_outbox_batch')).toHaveLength(2);
    expect(called('fail_outbox')).toHaveLength(1);
    expect(called('complete_outbox')).toHaveLength(1);
  });
});
