import type { SupabaseClient } from '@supabase/supabase-js';
import { readInBatches, readQueryRows } from './data/query-rows';

/** Public plan DTO. Supplier costs, commission, identities and explanation stay in SQL. */
export interface BuyerPlanRow {
  id: string;
  request_id: string;
  version: number;
  kind: string;
  status: string;
  delivery_kzt: number;
  supplier_rebate_kzt: number;
  total_kzt: number;
  eta_date: string | null;
  slack_days: number | null;
  supplier_count: number;
}

/** Keep the session-scoped RPC, bounded request batches and complete result pagination. */
export async function loadBuyerPlans(
  supabase: SupabaseClient,
  requestIds: string[],
): Promise<BuyerPlanRow[]> {
  const rows = await readInBatches(requestIds, (ids) =>
    readQueryRows<BuyerPlanRow>(() => supabase.rpc('get_buyer_plans', { p_request_ids: ids })),
  );
  return rows.sort((a, b) => b.version - a.version || a.id.localeCompare(b.id));
}
