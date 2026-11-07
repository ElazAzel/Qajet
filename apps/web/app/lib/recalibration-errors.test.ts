import { DEFAULT_WEIGHTS } from '@qajet/engine/match';
import { describe, expect, it } from 'vitest';
import {
  type LearningQueryStep,
  learningDatabase,
  learningStepAt,
} from '../../test/learning-query-fixture';
import {
  loadSupplierReliabilityMap,
  recalibrateEstimatorForOrder,
  recalibrateLeadTimeForSupplier,
  recalibrateMatcherForOrder,
} from './recalibration';

const PRIVATE_ERROR = 'E2E-private-provider-detail@example.test';
const features = {
  categoryMatch: 1,
  onTimeRate: 1,
  noDisputeRate: 1,
  responseSpeedScore: 1,
  winRate: 1,
  freshnessScore: 1,
  currentLoad: 0,
};

function leadtimeSteps(): LearningQueryStep[] {
  return [
    { table: 'orders', data: [{ id: 'E2E-order', approved_plan_id: 'E2E-plan' }] },
    {
      table: 'plan_lines',
      data: [
        { plan_id: 'E2E-plan', quote_line_id: 'E2E-quote', supplier_company_id: 'E2E-supplier' },
      ],
    },
    { table: 'quote_lines', data: [{ id: 'E2E-quote', lead_time_days: 2 }] },
    {
      table: 'order_stage_events',
      data: [{ order_id: 'E2E-order', to_state: 'suppliers_paid', at: '2026-01-01T00:00:00Z' }],
    },
    {
      table: 'order_supplier_deliveries',
      data: [
        {
          order_id: 'E2E-order',
          supplier_company_id: 'E2E-supplier',
          confirmed_at: '2026-01-03T00:00:00Z',
        },
      ],
    },
    {
      table: 'model_snapshots',
      data: { params: { bySupplier: [{ supplierId: 'E2E-other', kShrunk: 1.1 }] } },
    },
    { table: 'model_snapshots', operation: 'insert' },
  ];
}

function matcherSteps(): LearningQueryStep[] {
  return [
    {
      table: 'rfqs',
      data: [{ supplier_company_id: 'E2E-supplier', selection_reason: { features } }],
    },
    { table: 'plan_lines', data: [{ supplier_company_id: 'E2E-supplier' }] },
    { table: 'model_snapshots', data: { params: { weights: DEFAULT_WEIGHTS } } },
    { table: 'model_snapshots', operation: 'insert' },
  ];
}

function estimatorSteps(): LearningQueryStep[] {
  return [
    {
      table: 'orders',
      data: { request_id: 'E2E-request', final_cost_kzt: 120, approved_plan_id: 'E2E-plan' },
    },
    { table: 'estimates', data: { p50_kzt: 100 } },
    { table: 'request_items', data: [{ category: 'merch', specs: { itemKey: 'E2E-item' } }] },
    { table: 'model_snapshots', data: null },
    { table: 'plans', data: { total_supplier_kzt: 110 } },
    { table: 'price_observations', data: [{ qty: 10, unit_price_kzt: 11 }] },
    { table: 'model_snapshots', operation: 'insert' },
  ];
}

const cases = [
  {
    name: 'leadtime',
    steps: leadtimeSteps,
    run: (db: ReturnType<typeof learningDatabase>) =>
      recalibrateLeadTimeForSupplier(db.client, 'E2E-supplier'),
  },
  {
    name: 'matcher',
    steps: matcherSteps,
    run: (db: ReturnType<typeof learningDatabase>) =>
      recalibrateMatcherForOrder(db.client, {
        requestId: 'E2E-request',
        approvedPlanId: 'E2E-plan',
      }),
  },
  {
    name: 'estimator',
    steps: estimatorSteps,
    run: (db: ReturnType<typeof learningDatabase>) =>
      recalibrateEstimatorForOrder(db.client, 'E2E-order'),
  },
];

for (const scenario of cases) {
  describe(`${scenario.name}: database failures`, () => {
    for (const [index, step] of scenario.steps().entries()) {
      it(`rejects ${step.operation ?? 'select'} ${step.table} at step ${index + 1}`, async () => {
        const steps = scenario.steps();
        steps[index] = { ...step, data: null, error: { message: PRIVATE_ERROR } };
        const db = learningDatabase(steps);
        await expect(scenario.run(db)).rejects.toThrow(/learning\./);
        expect(db.calls).toHaveLength(index + 1);
        expect(db.calls.filter((call) => call.operation === 'insert')).toHaveLength(
          step.operation === 'insert' ? 1 : 0,
        );
      });
    }

    it('does not leak transport rejection details', async () => {
      const steps = scenario.steps();
      steps[0] = { ...learningStepAt(steps, 0), reject: new Error(PRIVATE_ERROR) };
      const db = learningDatabase(steps);
      const error = await scenario.run(db).catch((error: unknown) => error);
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain(PRIVATE_ERROR);
      expect(db.calls).toHaveLength(1);
    });

    it('retries a read failure before any write, then writes one snapshot', async () => {
      const first = learningStepAt(scenario.steps(), 0);
      const db = learningDatabase([
        { ...first, data: null, error: { message: PRIVATE_ERROR } },
        ...scenario.steps(),
      ]);
      await expect(scenario.run(db)).rejects.toThrow();
      expect(db.calls.every((call) => call.operation === 'select')).toBe(true);
      await expect(scenario.run(db)).resolves.toBeUndefined();
      expect(db.calls.filter((call) => call.operation === 'insert')).toHaveLength(1);
    });

    it('preserves a successful no-data result as a no-op', async () => {
      const first = learningStepAt(scenario.steps(), 0);
      const db = learningDatabase([{ ...first, data: scenario.name === 'estimator' ? null : [] }]);
      await expect(scenario.run(db)).resolves.toBeUndefined();
      expect(db.calls).toHaveLength(1);
    });

    it('writes a snapshot on the successful path', async () => {
      const db = learningDatabase(scenario.steps());
      await scenario.run(db);
      expect(db.calls).toHaveLength(scenario.steps().length);
      expect(db.calls.at(-1)).toMatchObject({
        operation: 'insert',
        table: 'model_snapshots',
        value: { model: scenario.name },
      });
    });
  });
}

describe('reliability reader', () => {
  it('does not substitute defaults when the snapshot read fails', async () => {
    const db = learningDatabase([{ table: 'model_snapshots', error: { message: PRIVATE_ERROR } }]);
    await expect(loadSupplierReliabilityMap(db.client, ['E2E-supplier'])).rejects.toThrow(
      /learning\./,
    );
  });

  it('keeps defaults for a missing snapshot and skips reads for an empty input', async () => {
    const db = learningDatabase([{ table: 'model_snapshots', data: null }]);
    expect(await loadSupplierReliabilityMap(db.client, [])).toEqual(new Map());
    expect(db.calls).toHaveLength(0);
    expect(await loadSupplierReliabilityMap(db.client, ['E2E-supplier'])).toEqual(new Map());
  });
});
