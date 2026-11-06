import { beforeEach, describe, expect, it, vi } from 'vitest';
import { database } from '../../../test/postgrest-fixture';

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../current-user', () => ({
  requireCurrentUser: async () => ({ id: 'buyer-user' }),
  orderActorFor: mocks.actor,
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ rpc: mocks.rpc, from: mocks.from }),
}));
vi.mock('../documents', () => ({
  buildActDocument: async () => ({ url: '/documents/e2e-act', meta: {} }),
  buildPrepayInvoiceDocument: vi.fn(),
}));
vi.mock('../autotimer', () => ({ logAutoTimeEntry: async () => undefined }));

import { advanceOrderStage, approvePlan, rateSupplier } from './order-actions';

const orderId = '00000000-0000-4000-8000-000000000001';
const supplierId = '00000000-0000-4000-8000-000000000002';
const planId = '00000000-0000-4000-8000-000000000003';
const requestId = '00000000-0000-4000-8000-000000000004';

describe('buyer plan RPC compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor.mockReturnValue('buyer');
  });

  function fixture(state: string, failPlan = false) {
    const db = database(
      {
        orders: [{ id: orderId, request_id: requestId, approved_plan_id: planId, state }],
        plans: [
          { id: planId, request_id: requestId, status: 'approved', total_kzt: 1200 },
          { id: 'newer-plan', request_id: requestId, status: 'proposed', total_kzt: 2000 },
        ],
        payment_facts: [
          {
            id: 'payment',
            order_id: orderId,
            direction: 'inbound',
            kind: 'prepayment',
            status: 'confirmed',
            amount_kzt: 1200,
          },
        ],
      },
      failPlan ? 'get_buyer_plans' : undefined,
    );
    mocks.from.mockImplementation((table: string) => {
      if (table === 'plans') throw new Error('Buyer cannot SELECT raw plans');
      return db.from(table);
    });
    mocks.rpc.mockImplementation((name: string, args: { p_request_ids: string[] }) =>
      name === 'get_buyer_plans'
        ? db.rpc(name, args)
        : Promise.resolve({ data: null, error: null }),
    );
  }

  it.each(['plan_proposed', 'awaiting_internal_approval'])(
    'accepts the void approve_plan response from %s without reading plan data',
    async (state) => {
      fixture(state);
      expect(await approvePlan(orderId, planId, 2)).toEqual({ ok: true });
      expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('approve_plan', {
        p_order_id: orderId,
        p_expected_plan_id: planId,
        p_expected_plan_version: 2,
      });
      expect(mocks.from).not.toHaveBeenCalledWith('plans');
    },
  );

  it('closes from the selected public plan total and retains settlement validation', async () => {
    fixture('accepted');
    expect(await advanceOrderStage(orderId, 'closed')).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith('get_buyer_plans', { p_request_ids: [requestId] });
    expect(mocks.rpc).toHaveBeenCalledWith(
      'advance_order_stage',
      expect.objectContaining({
        p_order_id: orderId,
        p_expected_state: 'accepted',
        p_to_state: 'closed',
        p_payload: expect.objectContaining({
          final_cost_kzt: 1200,
          settlement: 'exact',
          settlement_amount_kzt: 0,
        }),
      }),
    );
    expect(mocks.from).not.toHaveBeenCalledWith('plans');
  });

  it('does not close when the safe plan read fails or expose the provider error', async () => {
    fixture('accepted', true);
    const result = await advanceOrderStage(orderId, 'closed');
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('private provider detail');
    expect(mocks.rpc).not.toHaveBeenCalledWith('advance_order_stage', expect.anything());
    expect(mocks.from).not.toHaveBeenCalledWith('plans');
  });
});

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
