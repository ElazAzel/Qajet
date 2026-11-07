import 'server-only';

import { randomUUID } from 'node:crypto';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  recalibrateEstimatorForOrder,
  recalibrateLeadTimeForSupplier,
  recalibrateMatcherForOrder,
} from '../recalibration';
import { checkedLearningQuery, LearningOperationError, learningFailureCode } from './query';

interface LearningEventRow {
  id: string;
  type: string;
  payload: unknown;
  source_event_id: string | null;
}

interface SupplierLineRow {
  request_item_id: string;
  supplier_company_id: string;
  qty: number;
  quote_lines: { unit_price_kzt: number } | { unit_price_kzt: number }[] | null;
  request_items:
    | { category: string; specs: unknown }
    | { category: string; specs: unknown }[]
    | null;
}

export interface LearningDispatchResult {
  claimed: number;
  processed: number;
  failed: number;
  /** Failed events whose retry transition could not be confirmed. */
  retryUnconfirmed: number;
  errors: string[];
}

/** Processes one leased batch; retry/lease state is kept in PostgreSQL. */
export async function dispatchLearningEvents(limit = 10): Promise<LearningDispatchResult> {
  const supabase = createSupabaseAdminClient();
  const leaseId = randomUUID();
  const { data } = await checkedLearningQuery(
    supabase.rpc('claim_learning_events', { p_limit: limit, p_lease_id: leaseId }),
    'learning.claim',
  );

  const rows = (data ?? []) as LearningEventRow[];
  const result: LearningDispatchResult = {
    claimed: rows.length,
    processed: 0,
    failed: 0,
    retryUnconfirmed: 0,
    errors: [],
  };

  for (const row of rows) {
    try {
      await processLearningEvent(supabase, row);
      const { data: completed } = await checkedLearningQuery(
        supabase.rpc('complete_learning_event', { p_id: row.id, p_lease_id: leaseId }),
        'learning.complete',
      );
      if (completed !== true) throw new LearningOperationError('learning.complete_lease');
      result.processed += 1;
    } catch (error) {
      const message = learningFailureCode(error);
      result.failed += 1;
      result.errors.push(`${row.id}: ${message}`);
      try {
        const { data: failed } = await checkedLearningQuery(
          supabase.rpc('fail_learning_event', {
            p_id: row.id,
            p_lease_id: leaseId,
            p_error: message,
          }),
          'learning.retry_unconfirmed',
        );
        if (failed !== true) throw new LearningOperationError('learning.retry_unconfirmed');
      } catch {
        // The lease may expire/recover later, or an uncertain completion may
        // already have committed. Do not claim that a retry was scheduled.
        result.retryUnconfirmed += 1;
        result.errors.push(`${row.id}: learning.retry_unconfirmed`);
      }
    }
  }
  return result;
}

async function processLearningEvent(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  event: LearningEventRow,
): Promise<void> {
  const payload =
    typeof event.payload === 'object' && event.payload !== null
      ? (event.payload as { orderId?: unknown })
      : {};
  const orderId = typeof payload.orderId === 'string' ? payload.orderId : null;
  if (!orderId) throw new LearningOperationError('learning.order_id_missing');

  const { data: order } = await checkedLearningQuery(
    supabase
      .from('orders')
      .select('id, request_id, approved_plan_id')
      .eq('id', orderId)
      .maybeSingle(),
    'learning.order',
  );
  if (!order?.approved_plan_id) throw new LearningOperationError('learning.plan_missing');

  const supplierIds = await supplierIdsForPlan(supabase, order.approved_plan_id);
  if (event.type === 'order_delivered' || event.type === 'order_closed') {
    // Each update reads/writes the shared leadtime snapshot. Serializing here
    // avoids same-event lost updates and writes still running after a failure.
    // This does not serialize separate workers or make partial retries atomic.
    for (const id of supplierIds) await recalibrateLeadTimeForSupplier(supabase, id);
  }
  if (event.type !== 'order_closed') return;

  await recordPriceObservations(supabase, order.approved_plan_id, event.id);
  await recalibrateMatcherForOrder(supabase, {
    requestId: order.request_id,
    approvedPlanId: order.approved_plan_id,
  });
  await recalibrateEstimatorForOrder(supabase, order.id);
}

async function supplierIdsForPlan(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  planId: string,
): Promise<string[]> {
  const { data } = await checkedLearningQuery(
    supabase.from('plan_lines').select('supplier_company_id').eq('plan_id', planId),
    'learning.suppliers',
  );
  return [...new Set((data ?? []).map((row) => row.supplier_company_id as string))];
}

async function recordPriceObservations(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  planId: string,
  sourceEventId: string,
): Promise<void> {
  const { data } = await checkedLearningQuery(
    supabase
      .from('plan_lines')
      .select(
        'request_item_id, supplier_company_id, qty, quote_lines(unit_price_kzt), request_items(category, specs)',
      )
      .eq('plan_id', planId),
    'learning.observations_read',
  );

  const observations = ((data ?? []) as SupplierLineRow[]).flatMap((line) => {
    const quote = Array.isArray(line.quote_lines) ? line.quote_lines[0] : line.quote_lines;
    const item = Array.isArray(line.request_items) ? line.request_items[0] : line.request_items;
    const specs =
      typeof item?.specs === 'object' && item.specs !== null
        ? (item.specs as { itemKey?: unknown })
        : {};
    const itemKey =
      typeof specs.itemKey === 'string' && specs.itemKey ? specs.itemKey : item?.category;
    const unitPriceKzt = quote?.unit_price_kzt;
    if (
      !itemKey ||
      !Number.isSafeInteger(line.qty) ||
      line.qty <= 0 ||
      typeof unitPriceKzt !== 'number' ||
      !Number.isSafeInteger(unitPriceKzt) ||
      unitPriceKzt <= 0
    ) {
      return [];
    }
    return [
      {
        category: item?.category ?? 'unknown',
        item_key: itemKey,
        qty: line.qty,
        unit_price_kzt: unitPriceKzt,
        supplier_company_id: line.supplier_company_id,
        source: 'closed_order',
        source_event_id: sourceEventId,
        observation_key: `${sourceEventId}:${line.request_item_id}:${line.supplier_company_id}`,
      },
    ];
  });

  if (observations.length === 0) return;
  await checkedLearningQuery(
    supabase
      .from('price_observations')
      .upsert(observations, { onConflict: 'observation_key', ignoreDuplicates: true }),
    'learning.observations_write',
  );
}
