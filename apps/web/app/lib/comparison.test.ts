import { describe, expect, it, vi } from 'vitest';
import { database } from '../../test/postgrest-fixture';
import { loadRequestComparison } from './comparison';

vi.mock('./recalibration', () => ({ loadSupplierReliabilityMap: async () => new Map() }));

function fixture(settings: Array<{ key: string; value: unknown }>) {
  return database({
    requests: [
      { id: 'request', title: 'E2E-commission', deadline_date: '2099-12-31', city: 'Алматы' },
    ],
    request_items: [
      { id: 'item', request_id: 'request', name: 'Item', category: 'merch', qty: 10, unit: 'шт' },
    ],
    rfqs: [{ id: 'rfq', request_id: 'request', supplier_company_id: 'supplier' }],
    companies: [{ id: 'supplier', name: 'E2E supplier', city: 'Алматы', tax_mode: 'general' }],
    quotes: [
      { id: 'quote', rfq_id: 'rfq', version: 1, submitted_at: '2026-01-01', valid_until: null },
    ],
    quote_lines: [
      {
        id: 'line',
        quote_id: 'quote',
        request_item_id: 'item',
        unit_price_kzt: 10_000,
        min_qty: null,
        setup_fee_kzt: 0,
        lead_time_days: 1,
        bundle_rule: null,
        capability_confirmed: true,
        field_flags: {},
      },
    ],
    settings,
  });
}

describe('comparison commission', () => {
  it('uses the standard 15% when settings are absent', async () => {
    const comparison = await loadRequestComparison(fixture([]), 'request');
    expect(comparison?.commissionRatePct).toBe(15);
    expect(comparison?.result.plans[0]).toMatchObject({
      totalSupplierKzt: 100_000,
      commissionKzt: 15_000,
      totalKzt: 120_000,
    });
  });

  it.each([10, 12.5, 15])('preserves the configured valid rate %s', async (value) => {
    const comparison = await loadRequestComparison(
      fixture([{ key: 'commission_rate_pct', value }]),
      'request',
    );
    expect(comparison?.commissionRatePct).toBe(value);
    expect(comparison?.result.plans[0]?.commissionKzt).toBe(value * 1000);
  });

  it.each([23, 24, 9, 15.01, '15', null, Number.NaN, Number.POSITIVE_INFINITY])(
    'does not use an obsolete or malformed rate %s in a new plan',
    async (value) => {
      const comparison = await loadRequestComparison(
        fixture([{ key: 'commission_rate_pct', value }]),
        'request',
      );
      expect(comparison?.commissionRatePct).toBe(15);
      expect(comparison?.result.plans[0]?.commissionKzt).toBe(15_000);
    },
  );
});
