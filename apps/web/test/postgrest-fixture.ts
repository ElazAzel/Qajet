import type { SupabaseClient } from '@supabase/supabase-js';

type Row = Record<string, unknown>;
export function database(tables: Record<string, Row[]>, failTable?: string) {
  return {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      const orders: Array<[string, boolean]> = [];
      let limit = 1000;
      let projection = '';
      let badIn = false;
      function result() {
        if (table === failTable || badIn)
          return { data: null, error: { message: 'private provider detail' } };
        let rows = [...(tables[table] ?? [])].filter((row) =>
          filters.every((filter) => filter(row)),
        );
        rows.sort((a, b) => {
          for (const [key, ascending] of orders) {
            const comparison = String(a[key] ?? '').localeCompare(String(b[key] ?? ''));
            if (comparison) return ascending ? comparison : -comparison;
          }
          return 0;
        });
        rows = rows.slice(0, Math.min(limit, 1000));
        if (projection.includes('id:thread_id'))
          rows = rows.map((row) => ({ ...row, id: row.thread_id }));
        return { data: rows, error: null };
      }
      const query = {
        select(columns: string) {
          projection = columns;
          return query;
        },
        eq(key: string, value: unknown) {
          filters.push((row) => row[key] === value);
          return query;
        },
        in(key: string, values: unknown[]) {
          badIn ||= values.length > 100;
          filters.push((row) => values.includes(row[key]));
          return query;
        },
        gt(key: string, value: string) {
          filters.push((row) => String(row[key]) > value);
          return query;
        },
        lte(key: string, value: string) {
          filters.push((row) => String(row[key]) <= value);
          return query;
        },
        not(key: string, _operator: string, values: string) {
          filters.push((row) => !values.slice(1, -1).split(',').includes(String(row[key])));
          return query;
        },
        order(key: string, options?: { ascending?: boolean }) {
          orders.push([key, options?.ascending !== false]);
          return query;
        },
        limit(value: number) {
          limit = value;
          return query;
        },
        maybeSingle() {
          const r = result();
          return Promise.resolve({ ...r, data: r.data?.[0] ?? null });
        },
        // biome-ignore lint/suspicious/noThenProperty: emulate the PostgREST awaitable builder.
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve(resolve(result()));
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
}
