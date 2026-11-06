import type { SupabaseClient } from '@supabase/supabase-js';

export interface LearningQueryStep {
  table: string;
  operation?: 'select' | 'insert' | 'upsert';
  data?: unknown;
  error?: unknown;
  reject?: Error;
}

export interface LearningQueryCall {
  table: string;
  operation: 'select' | 'insert' | 'upsert';
  value?: unknown;
  options?: unknown;
}

export function learningStepAt(steps: LearningQueryStep[], index: number): LearningQueryStep {
  const step = steps[index];
  if (!step) throw new Error(`Missing fixture step ${index}`);
  return step;
}

/** Scripted transport results, not a simulation of PostgreSQL or authorization. */
export function learningDatabase(steps: LearningQueryStep[]) {
  const calls: LearningQueryCall[] = [];
  const client = {
    from(table: string) {
      const call: LearningQueryCall = { table, operation: 'select' };
      let result: Promise<{ data: unknown; error: unknown }> | undefined;
      function execute() {
        const step = steps[calls.length];
        calls.push({ ...call });
        if (!step || step.table !== table || (step.operation ?? 'select') !== call.operation) {
          throw new Error(`Unexpected fixture query ${calls.length}: ${table}/${call.operation}`);
        }
        if (step.reject) throw step.reject;
        return { data: step.data ?? null, error: step.error ?? null };
      }
      const query = {
        select(_columns: string) {
          return query;
        },
        eq(_column: string, _value: unknown) {
          return query;
        },
        in(_column: string, _values: unknown[]) {
          return query;
        },
        order(_column: string, _options: unknown) {
          return query;
        },
        limit(_limit: number) {
          return query;
        },
        maybeSingle() {
          return query;
        },
        insert(value: unknown) {
          call.operation = 'insert';
          call.value = value;
          return query;
        },
        upsert(value: unknown, options: unknown) {
          call.operation = 'upsert';
          call.value = value;
          call.options = options;
          return query;
        },
        // biome-ignore lint/suspicious/noThenProperty: PostgREST builders are awaitable.
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          result ??= Promise.resolve().then(execute);
          return result.then(resolve, reject);
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}
