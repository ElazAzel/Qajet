import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { loadAdminHome } from './admin-home';
import { loadBuyerAnalytics } from './buyer-analytics';

// Emulate PostgREST's row cap, filtering, ranges and exact HEAD count.
function database(
  orderCount = 1001,
  pendingCount = 23,
  failPage = false,
  failCounts = false,
  concurrentClose = false,
) {
  const rows = Array.from({ length: orderCount }, (_, n) => ({
    id: String(n).padStart(8, '0'),
    state: 'closed',
    final_cost_kzt: 10,
    closed_at: new Date().toISOString(),
    requests: {
      created_by: 'employee',
      users: { full_name: 'E2E employee' },
      request_items: [{ category: 'merch' }],
    },
  }));
  const companies = [
    ...Array.from({ length: pendingCount }, () => ({
      type: 'supplier',
      is_active: true,
      verified_at: null,
    })),
    { type: 'supplier', is_active: true, verified_at: '2026-01-01' },
    { type: 'supplier', is_active: false, verified_at: null },
    { type: 'buyer', is_active: true, verified_at: null },
  ];
  let orderReads = 0;
  return {
    from(table: string) {
      let countOnly = false;
      let start = 0;
      let end = 999;
      let previousMonth = false;
      const filters: Array<[string, unknown]> = [];
      let after: string | undefined;
      let cutoff: string | undefined;
      const query = {
        select(_columns: string, options?: { head?: boolean }) {
          countOnly = !!options?.head;
          return query;
        },
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return query;
        },
        is(column: string, value: unknown) {
          filters.push([column, value]);
          return query;
        },
        gte() {
          return query;
        },
        lt() {
          previousMonth = true;
          return query;
        },
        gt(_column: string, value: string) {
          after = value;
          return query;
        },
        lte(_column: string, value: string) {
          cutoff = value;
          return query;
        },
        order() {
          return query;
        },
        limit(n: number) {
          end = n - 1;
          return query;
        },
        range(a: number, b: number) {
          start = a;
          end = b;
          return query;
        },
        // biome-ignore lint/suspicious/noThenProperty: emulate the awaitable PostgREST query builder.
        then(resolve: (value: unknown) => unknown) {
          if (failPage && table === 'orders' && (start > 0 || after))
            return Promise.resolve(
              resolve({ data: null, error: { message: 'private database detail' } }),
            );
          if (table === 'orders' && !previousMonth) {
            orderReads += 1;
            if (concurrentClose && orderReads === 2) {
              const first = rows[0];
              if (!first) throw new Error('Expected fixture order');
              const newlyClosed = {
                ...first,
                final_cost_kzt: 100,
                requests: { ...first.requests, created_by: 'new-employee' },
                closed_at: new Date(Date.now() + 60000).toISOString(),
              };
              rows.unshift({ ...newlyClosed, id: '-new' });
              rows.push({ ...newlyClosed, id: 'z-new' });
            }
          }
          return Promise.resolve(
            resolve({
              data: countOnly
                ? null
                : table === 'orders' && !previousMonth
                  ? rows
                      .filter(
                        (row) => (!after || row.id > after) && (!cutoff || row.closed_at <= cutoff),
                      )
                      .slice(start, end + 1)
                  : [],
              count: !countOnly
                ? null
                : table === 'companies'
                  ? companies.filter((row) =>
                      filters.every(([key, value]) => row[key as keyof typeof row] === value),
                    ).length
                  : pendingCount,
              error:
                failCounts && countOnly && table === 'users' ? { message: 'private detail' } : null,
            }),
          );
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

describe('complete analytics histories', () => {
  it('includes orders beyond the PostgREST cap in totals and employee spend', async () => {
    const result = await loadBuyerAnalytics(database());
    expect(result.ordersCount).toBe(1001);
    expect(result.totalKzt).toBe(10010);
    expect(result.byEmployee[0]?.ordersCount).toBe(1001);
  });
  it('counts only active unverified suppliers across the complete mixed company set', async () => {
    const result = await loadAdminHome(database());
    expect(result.pendingVerificationCount).toBe(23);
    expect(result.turnoverThisMonthKzt).toBe(10010);
  });
  it('fails instead of returning partial financial totals when a later page is unavailable', async () => {
    await expect(loadBuyerAnalytics(database(1001, 23, true))).rejects.toThrow();
  });
  it('does not double-count or include newly closed orders between pages', async () => {
    const result = await loadBuyerAnalytics(database(1001, 23, false, false, true));
    expect(result.ordersCount).toBe(1001);
    expect(result.totalKzt).toBe(10010);
    expect(result.byEmployee.map((row) => row.userId)).toEqual(['employee']);
  });
  it('does not show zero counts when admin database queries fail', async () => {
    await expect(loadAdminHome(database(0, 0, false, true))).rejects.toThrow();
  });
});
