import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type LearningQueryStep,
  learningDatabase,
  learningStepAt,
} from '../../../test/learning-query-fixture';

const state = vi.hoisted(() => ({
  client: null as unknown,
  leadtime: vi.fn(),
  matcher: vi.fn(),
  estimator: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => state.client }));
vi.mock('../recalibration', () => ({
  recalibrateLeadTimeForSupplier: state.leadtime,
  recalibrateMatcherForOrder: state.matcher,
  recalibrateEstimatorForOrder: state.estimator,
}));

import { dispatchLearningEvents } from './dispatcher';

const PRIVATE_ERROR = 'E2E-private-provider-detail@example.test';
const event = (id = 'E2E-event', type = 'order_closed') => ({
  id,
  type,
  payload: { orderId: 'E2E-order' },
  source_event_id: 'E2E-stage',
});
function queries(supplierIds: string[] = [], type = 'order_closed'): LearningQueryStep[] {
  return [
    {
      table: 'orders',
      data: { id: 'E2E-order', request_id: 'E2E-request', approved_plan_id: 'E2E-plan' },
    },
    {
      table: 'plan_lines',
      data: supplierIds.map((supplier_company_id) => ({ supplier_company_id })),
    },
    ...(type === 'order_closed' ? [{ table: 'plan_lines', data: [] }] : []),
  ];
}
function setup(steps = queries(), rows = [event()]) {
  const db = learningDatabase(steps);
  const rpc = vi.fn(
    async (name: string, _args: unknown): Promise<{ data: unknown; error: unknown }> => ({
      data: name === 'claim_learning_events' ? rows : true,
      error: null,
    }),
  );
  state.client = Object.assign(db.client, { rpc });
  return { ...db, rpc };
}
function called(rpc: ReturnType<typeof setup>['rpc'], name: string) {
  return rpc.mock.calls.filter(([method]) => method === name);
}

beforeEach(() => {
  for (const fn of [state.leadtime, state.matcher, state.estimator]) {
    fn.mockReset();
    fn.mockResolvedValue(undefined);
  }
});

describe('learning dispatcher error boundaries', () => {
  it.each(['error', 'reject'])(
    'fails the claim safely on %s without starting work',
    async (mode) => {
      const db = setup();
      if (mode === 'reject') db.rpc.mockRejectedValue(new Error(PRIVATE_ERROR));
      else db.rpc.mockResolvedValue({ data: null, error: { message: PRIVATE_ERROR } });
      const error = await dispatchLearningEvents().catch((error: unknown) => error);
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain('learning.claim');
      expect(String(error)).not.toContain(PRIVATE_ERROR);
      expect(db.calls).toHaveLength(0);
    },
  );

  it('does nothing for a successful empty claim', async () => {
    const db = setup([], []);
    expect(await dispatchLearningEvents()).toMatchObject({
      claimed: 0,
      processed: 0,
      failed: 0,
      retryUnconfirmed: 0,
    });
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.calls).toHaveLength(0);
  });

  it.each([0, 1, 2])('does not complete an event after required SELECT %i fails', async (index) => {
    const steps = queries();
    steps[index] = {
      ...learningStepAt(steps, index),
      data: null,
      error: { message: PRIVATE_ERROR },
    };
    const db = setup(steps);
    const result = await dispatchLearningEvents();
    expect(result).toMatchObject({ claimed: 1, processed: 0, failed: 1, retryUnconfirmed: 0 });
    expect(called(db.rpc, 'complete_learning_event')).toHaveLength(0);
    expect(called(db.rpc, 'fail_learning_event')).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(PRIVATE_ERROR);
    expect(JSON.stringify(called(db.rpc, 'fail_learning_event'))).not.toContain(PRIVATE_ERROR);
    expect(state.matcher).not.toHaveBeenCalled();
  });

  it('does not complete or train when the price-observation write fails', async () => {
    const steps = queries();
    steps[2] = {
      table: 'plan_lines',
      data: [
        {
          request_item_id: 'E2E-item',
          supplier_company_id: 'E2E-supplier',
          qty: 2,
          quote_lines: { unit_price_kzt: 100 },
          request_items: { category: 'merch', specs: { itemKey: 'E2E-item' } },
        },
      ],
    };
    steps.push({
      table: 'price_observations',
      operation: 'upsert',
      error: { message: PRIVATE_ERROR },
    });
    const db = setup(steps);
    const result = await dispatchLearningEvents();
    expect(result).toMatchObject({ processed: 0, failed: 1 });
    expect(state.matcher).not.toHaveBeenCalled();
    expect(called(db.rpc, 'complete_learning_event')).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain(PRIVATE_ERROR);
    expect(db.calls.at(-1)).toMatchObject({
      options: { onConflict: 'observation_key', ignoreDuplicates: true },
      value: [{ observation_key: 'E2E-event:E2E-item:E2E-supplier' }],
    });
  });

  it('continues the batch after one model update fails and only completes the other event', async () => {
    const db = setup([...queries(), ...queries()], [event('E2E-failed'), event('E2E-success')]);
    state.matcher.mockRejectedValueOnce(new Error(PRIVATE_ERROR));
    expect(await dispatchLearningEvents()).toMatchObject({
      claimed: 2,
      processed: 1,
      failed: 1,
      retryUnconfirmed: 0,
    });
    expect(called(db.rpc, 'complete_learning_event')).toMatchObject([
      ['complete_learning_event', { p_id: 'E2E-success' }],
    ]);
    expect(called(db.rpc, 'fail_learning_event')).toMatchObject([
      ['fail_learning_event', { p_id: 'E2E-failed', p_error: 'learning.processing' }],
    ]);
  });

  it.each(['error', 'false', 'reject'])(
    'records unconfirmed retry state on fail RPC %s and continues',
    async (mode) => {
      const db = setup([...queries(), ...queries()], [event('E2E-failed'), event('E2E-success')]);
      state.matcher.mockRejectedValueOnce(new Error(PRIVATE_ERROR));
      db.rpc.mockImplementation(async (name) => {
        if (name === 'claim_learning_events')
          return { data: [event('E2E-failed'), event('E2E-success')], error: null };
        if (name === 'fail_learning_event') {
          if (mode === 'reject') throw new Error(PRIVATE_ERROR);
          return {
            data: mode === 'false' ? false : null,
            error: mode === 'error' ? { message: PRIVATE_ERROR } : null,
          };
        }
        return { data: true, error: null };
      });
      const result = await dispatchLearningEvents();
      expect(result).toMatchObject({ processed: 1, failed: 1, retryUnconfirmed: 1 });
      expect(JSON.stringify(result)).not.toContain(PRIVATE_ERROR);
      expect(result.errors.join(' ')).toContain('learning.retry_unconfirmed');
    },
  );

  it.each(['error', 'false', 'reject'])(
    'does not count an uncertain completion as processed: %s',
    async (mode) => {
      const db = setup();
      db.rpc.mockImplementation(async (name) => {
        if (name === 'claim_learning_events') return { data: [event()], error: null };
        if (name === 'complete_learning_event') {
          if (mode === 'reject') throw new Error(PRIVATE_ERROR);
          return {
            data: mode === 'false' ? false : null,
            error: mode === 'error' ? { message: PRIVATE_ERROR } : null,
          };
        }
        return { data: true, error: null };
      });
      const result = await dispatchLearningEvents();
      expect(result).toMatchObject({ processed: 0, failed: 1, retryUnconfirmed: 0 });
      expect(state.estimator).toHaveBeenCalledTimes(1);
      expect(called(db.rpc, 'fail_learning_event')).toHaveLength(1);
      expect(JSON.stringify(result)).not.toContain(PRIVATE_ERROR);
    },
  );

  it('processes shared lead-time snapshots sequentially, with no later supplier started on failure', async () => {
    const db = setup(queries(['E2E-a', 'E2E-b'], 'order_delivered'), [
      event('E2E-event', 'order_delivered'),
    ]);
    state.leadtime.mockRejectedValueOnce(new Error(PRIVATE_ERROR));
    expect(await dispatchLearningEvents()).toMatchObject({ processed: 0, failed: 1 });
    expect(state.leadtime).toHaveBeenCalledTimes(1);
    expect(state.leadtime.mock.calls[0]?.[1]).toBe('E2E-a');
    expect(called(db.rpc, 'complete_learning_event')).toHaveLength(0);
  });

  it('waits for a supplier update before beginning the next one', async () => {
    setup(queries(['E2E-a', 'E2E-b'], 'order_delivered'), [event('E2E-event', 'order_delivered')]);
    let release: (() => void) | undefined;
    state.leadtime.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const pending = dispatchLearningEvents();
    await vi.waitFor(() => expect(release).toBeDefined());
    expect(state.leadtime).toHaveBeenCalledTimes(1);
    release?.();
    expect(await pending).toMatchObject({ processed: 1, failed: 0 });
    expect(state.leadtime.mock.calls.map((call) => call[1])).toEqual(['E2E-a', 'E2E-b']);
  });

  it('retries after an early failure and completes only the successful attempt', async () => {
    const failed = {
      ...learningStepAt(queries(), 0),
      data: null,
      error: { message: PRIVATE_ERROR },
    };
    const db = setup([failed, ...queries()]);
    expect(await dispatchLearningEvents()).toMatchObject({ processed: 0, failed: 1 });
    expect(state.matcher).not.toHaveBeenCalled();
    expect(await dispatchLearningEvents()).toMatchObject({ processed: 1, failed: 0 });
    expect(called(db.rpc, 'complete_learning_event')).toHaveLength(1);
  });

  it('reports partial failure honestly; a retry still repeats an already successful model stage', async () => {
    // Characterization of the remaining at-least-once limitation, NOT idempotency proof.
    const db = setup([...queries(), ...queries()]);
    state.estimator.mockRejectedValueOnce(new Error(PRIVATE_ERROR));
    expect(await dispatchLearningEvents()).toMatchObject({ processed: 0, failed: 1 });
    expect(called(db.rpc, 'complete_learning_event')).toHaveLength(0);
    expect(state.matcher).toHaveBeenCalledTimes(1);
    expect(await dispatchLearningEvents()).toMatchObject({ processed: 1, failed: 0 });
    expect(state.matcher).toHaveBeenCalledTimes(2);
    expect(called(db.rpc, 'complete_learning_event')).toHaveLength(1);
  });
});
