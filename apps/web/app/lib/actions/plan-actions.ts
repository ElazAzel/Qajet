'use server';

import {
  type CommissionOverrideSample,
  type CommissionSuggestion,
  isValidCommissionPct,
  suggestCommissionPct,
} from '@qajet/engine/commission';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { actionFailure } from '../action-result';
import { orderActorFor, requireCurrentUser } from '../current-user';
import { PLAN_EDITABLE_STATES } from '../order-state';
import type { ActionResult } from './order-actions';
import { loadOrder } from './order-actions';

/**
 * Комиссия по позиции плана — agents.md §7, задача «комиссия платформы».
 * По умолчанию каждая plan_lines строка получает плоскую ставку из settings
 * (proposePlan(), packages/db/migrations 0012-0014). Здесь — точечная
 * правка консьержем в диапазоне 10-15% (объём, сложность исполнения),
 * подсказка на основе прошлых правок (learning_events, тот же приём, что
 * extraction_fix/extraction_aliases в Classification Engine) — подсказка,
 * не авто-применение, решение остаётся за человеком.
 */

interface PlanLineForUpdate {
  planId: string;
  requestItemId: string;
  lineTotalKzt: number;
  commissionPct: number;
  category: string | null;
}

async function loadPlanLineForUpdate(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  planLineId: string,
): Promise<PlanLineForUpdate | null> {
  const { data } = await supabase
    .from('plan_lines')
    .select(
      'plan_id, request_item_id, line_total_kzt, commission_pct, plans(request_id), request_items(category)',
    )
    .eq('id', planLineId)
    .maybeSingle();
  if (!data) return null;

  const plan = Array.isArray(data.plans) ? data.plans[0] : data.plans;
  const requestItem = Array.isArray(data.request_items)
    ? data.request_items[0]
    : data.request_items;
  if (!plan) return null;

  return {
    planId: data.plan_id,
    requestItemId: data.request_item_id,
    lineTotalKzt: data.line_total_kzt,
    commissionPct: data.commission_pct,
    category: requestItem?.category ?? null,
  };
}

export async function updatePlanLineCommission(
  planLineId: string,
  pct: number,
): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const actor = orderActorFor(user);
  if (actor !== 'concierge' && actor !== 'admin') {
    return { ok: false, error: 'Только консьерж может менять комиссию по позиции' };
  }
  if (!isValidCommissionPct(pct)) {
    return { ok: false, error: 'Комиссия по позиции — от 10% до 15%' };
  }

  const supabase = await createSupabaseServerClient();

  const line = await loadPlanLineForUpdate(supabase, planLineId);
  if (!line) return { ok: false, error: 'Позиция плана не найдена' };

  // plan_lines не хранит request_id напрямую, только через plan_id —
  // loadOrder() ищет по request_id заявки, поэтому сначала берём его у plans.
  const { data: planRow } = await supabase
    .from('plans')
    .select('request_id')
    .eq('id', line.planId)
    .maybeSingle();
  if (!planRow) return { ok: false, error: 'План не найден' };
  const order = await loadOrder(supabase, { requestId: planRow.request_id });
  if (!order) return { ok: false, error: 'Заказ не найден' };
  if (!PLAN_EDITABLE_STATES.includes(order.state)) {
    return { ok: false, error: 'Комиссию нельзя менять после утверждения плана покупателем' };
  }

  const { error: updateError } = await supabase.rpc('update_plan_line_commission', {
    p_plan_line_id: planLineId,
    p_commission_pct: pct,
  });
  if (updateError) return actionFailure('plan.updatePlanLineCommission', updateError);

  if (line.category) {
    await supabase.from('learning_events').insert({
      type: 'commission_override',
      payload: {
        planLineId,
        requestItemId: line.requestItemId,
        category: line.category,
        fromPct: line.commissionPct,
        toPct: pct,
        correctedBy: user.id,
      },
    });
  }

  revalidatePath(`/concierge/orders/${order.id}`);
  revalidatePath(`/buyer/orders/${order.id}`);
  return { ok: true };
}

export interface ConciergePlanLine {
  id: string;
  name: string;
  category: string;
  qty: number;
  unit: string;
  supplierLineTotalKzt: number;
  commissionPct: number;
  commissionKzt: number;
  buyerTotalKzt: number;
}

export async function loadPlanLinesForConcierge(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  planId: string,
): Promise<ConciergePlanLine[]> {
  const { data } = await supabase
    .from('plan_lines')
    .select(
      'id, qty, line_total_kzt, commission_pct, commission_kzt, request_items(name, category, unit)',
    )
    .eq('plan_id', planId)
    .order('created_at', { ascending: true });

  return (data ?? []).map((row) => {
    const item = Array.isArray(row.request_items) ? row.request_items[0] : row.request_items;
    return {
      id: row.id,
      name: item?.name ?? '—',
      category: item?.category ?? '—',
      qty: row.qty,
      unit: item?.unit ?? '',
      supplierLineTotalKzt: row.line_total_kzt,
      commissionPct: row.commission_pct,
      commissionKzt: row.commission_kzt,
      buyerTotalKzt: row.line_total_kzt + row.commission_kzt,
    };
  });
}

/**
 * Подсказка процента по категории — усреднение прошлых правок консьержа
 * (learning_events.type='commission_override'), порог образцов и клампинг
 * — в packages/engine/src/commission. Подсказка, не авто-применение.
 */
export async function loadCommissionSuggestions(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
): Promise<Map<string, CommissionSuggestion>> {
  const { data } = await supabase
    .from('learning_events')
    .select('payload')
    .eq('type', 'commission_override');

  const samples: CommissionOverrideSample[] = (data ?? [])
    .map((row) => row.payload as { category?: unknown; toPct?: unknown })
    .filter(
      (p): p is { category: string; toPct: number } =>
        typeof p.category === 'string' && typeof p.toPct === 'number',
    )
    .map((p) => ({ category: p.category, pct: p.toPct }));

  const categories = [...new Set(samples.map((s) => s.category))];
  const suggestions = new Map<string, CommissionSuggestion>();
  for (const category of categories) {
    const suggestion = suggestCommissionPct(category, samples);
    if (suggestion) suggestions.set(category, suggestion);
  }
  return suggestions;
}
