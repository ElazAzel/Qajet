import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  rpc: vi.fn(),
  updateResult: { error: null, count: 0 },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../current-user', () => ({
  requireCurrentUser: async () => ({}),
  orderActorFor: mocks.actor,
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    rpc: mocks.rpc,
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { id: 'rfq', status: 'sent' } }) }),
      }),
      insert: () => ({
        error: null,
        select: () => ({ single: async () => ({ data: { id: 'quote' } }) }),
      }),
      update: () => ({ eq: () => ({ ...mocks.updateResult, eq: async () => mocks.updateResult }) }),
    }),
  }),
}));

import { declineRfq, type QuoteLineInput, submitQuote } from './supplier-actions';

const valid: QuoteLineInput = {
  requestItemId: '00000000-0000-4000-8000-000000000001',
  unitPriceKzt: 100,
  leadTimeDays: 2,
  capabilityConfirmed: true,
};
const validRfqId = '00000000-0000-4000-8000-000000000002';

describe('supplier RFQ actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor.mockReturnValue('supplier');
    mocks.rpc.mockResolvedValue({ error: null });
  });
  it.each([
    { unitPriceKzt: 0.1 },
    { unitPriceKzt: Number.MAX_SAFE_INTEGER + 1 },
    { setupFeeKzt: -1 },
    { setupFeeKzt: Number.NaN },
    { minQty: -1 },
    { minQty: 1.5 },
    { leadTimeDays: 0.1 },
    { leadTimeDays: 2147483648 },
  ])('не принимает некорректные числа %j', async (patch) => {
    expect(await submitQuote(validRfqId, [{ ...valid, ...patch }])).toMatchObject({ ok: false });
  });
  it('отклоняет повтор одной позиции', async () => {
    expect(await submitQuote(validRfqId, [valid, valid])).toMatchObject({ ok: false });
  });
  it('не сообщает об успешном отказе, если запрос недоступен или уже отвечен', async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { message: 'RFQ недоступен' } });
    expect(await declineRfq(validRfqId)).toMatchObject({ ok: false });
  });
  it('принимает корректное предложение', async () => {
    expect(await submitQuote(validRfqId, [valid])).toEqual({ ok: true });
  });
});
