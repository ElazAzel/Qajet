import { describe, expect, it } from 'vitest';
import { buildServiceCost } from './metrics';

describe('service cost metrics', () => {
  it('allocates recorded work from non-converted RFQs to closed wins', () => {
    const result = buildServiceCost({
      secondsByOrder: new Map([
        ['closed-order', 3600],
        ['lost-rfq-order', 1800],
      ]),
      closedOrderCount: 1,
      requestsWithRfq: 4,
      requestsWithRfqAndOrder: 2,
      hourCostKzt: 1000,
    });

    expect(result).toEqual({
      directHours: 1.5,
      allocatedHours: 1.5,
      hourCostKzt: 1000,
      fullCostKzt: 3000,
    });
  });

  it('does not invent a unit cost without a closed order or hour rate', () => {
    expect(
      buildServiceCost({
        secondsByOrder: new Map([['order', 3600]]),
        closedOrderCount: 0,
        requestsWithRfq: 1,
        requestsWithRfqAndOrder: 0,
        hourCostKzt: 1000,
      }),
    ).toBeNull();
    expect(
      buildServiceCost({
        secondsByOrder: new Map([['order', 3600]]),
        closedOrderCount: 1,
        requestsWithRfq: 1,
        requestsWithRfqAndOrder: 0,
        hourCostKzt: 0,
      }),
    ).toBeNull();
  });
});
