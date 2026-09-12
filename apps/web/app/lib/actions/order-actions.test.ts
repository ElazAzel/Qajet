import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../current-user', () => ({
  requireCurrentUser: async () => ({ id: 'buyer-user' }),
  orderActorFor: mocks.actor,
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ rpc: mocks.rpc }),
}));

import { rateSupplier } from './order-actions';

const orderId = '00000000-0000-4000-8000-000000000001';
const supplierId = '00000000-0000-4000-8000-000000000002';

describe('buyer supplier ratings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor.mockReturnValue('buyer');
    mocks.rpc.mockResolvedValue({ error: null });
  });

  it('отклоняет оценку вне диапазона и не вызывает БД', async () => {
    const result = await rateSupplier(orderId, supplierId, {
      buyerScore1To5: 6,
      wasOnTime: true,
      hadDispute: false,
    });

    expect(result).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('разрешает только покупателю отправить оценку', async () => {
    mocks.actor.mockReturnValue('concierge');

    const result = await rateSupplier(orderId, supplierId, {
      buyerScore1To5: 5,
      wasOnTime: true,
      hadDispute: false,
    });

    expect(result).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('передаёт корректную оценку в защищённый RPC', async () => {
    const result = await rateSupplier(orderId, supplierId, {
      buyerScore1To5: 4,
      wasOnTime: false,
      hadDispute: true,
      comment: 'Срок согласовали отдельно',
    });

    expect(result).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith('submit_supplier_rating', {
      p_order_id: orderId,
      p_supplier_company_id: supplierId,
      p_buyer_score: 4,
      p_was_on_time: false,
      p_had_dispute: true,
      p_comment: 'Срок согласовали отдельно',
    });
  });
});
