import { afterEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({ rpc }),
}));

import { dispatchOutbox } from './dispatcher';

afterEach(() => {
  vi.unstubAllEnvs();
  rpc.mockReset();
});

describe('dispatchOutbox', () => {
  it('в production без ключа не забирает очередь: попытки не сгорают, строки остаются pending', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RESEND_API_KEY', '');

    await expect(dispatchOutbox(20)).rejects.toThrow(/RESEND_API_KEY/);

    // claim_outbox_batch увеличивает attempts, поэтому до него доходить нельзя.
    expect(rpc).not.toHaveBeenCalled();
  });

  it('вне production без ключа разбирает очередь через локальный приёмник', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('RESEND_API_KEY', '');
    rpc.mockImplementation(async (name: string) => {
      if (name === 'claim_outbox_batch') {
        return {
          data: [
            {
              id: 'row-1',
              idempotency_key: 'k1',
              recipient: 'a@example.test',
              subject: 's',
              body: 'b',
            },
          ],
          error: null,
        };
      }
      return { data: true, error: null };
    });

    const result = await dispatchOutbox(20);

    expect(result).toMatchObject({ claimed: 1, sent: 1, failed: 0 });
  });
});
