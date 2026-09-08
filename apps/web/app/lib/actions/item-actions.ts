'use server';

import { normalizeText } from '@qajet/engine/intake';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { orderActorFor, requireCurrentUser } from '../current-user';
import { ITEMS_EDITABLE_STATES } from '../order-state';
import { loadOrder } from './order-actions';

/**
 * Правки консьержа над request_items — agents.md §8A (Classification
 * Engine) и Dependency Engine (split/merge, следующие шаги волны). Общий
 * гейт по стадии заказа: quote_lines/plan_lines ссылаются на request_items
 * с onDelete:'restrict', так что правка позиций безопасна только до
 * rfq_sent — то же окно, что уже показывает apps/web/app/concierge/
 * orders/[id]/items/page.tsx (ITEMS_EDITABLE_STATES, общий источник
 * правды в apps/web/app/lib/order-state.ts).
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
}

async function assertItemsEditable(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  requestId: string,
): Promise<string | null> {
  const order = await loadOrder(supabase, { requestId });
  if (!order) return 'Заказ не найден';
  if (!ITEMS_EDITABLE_STATES.includes(order.state)) {
    return 'Позиции нельзя менять после отправки RFQ';
  }
  return null;
}

/**
 * Смена категории/названия позиции. Если категория реально изменилась —
 * это и есть исправление классификации: пишет learning_events и апсертит
 * extraction_aliases со счётчиком hits (agents.md §8A: «hits ≥ 3 начинает
 * применяться автоматически» — используется в шаге 5 волны).
 */
export async function correctItemClassification(
  itemId: string,
  patch: { category: string; name: string },
): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const actor = orderActorFor(user);
  if (actor !== 'concierge' && actor !== 'admin') {
    return { ok: false, error: 'Только концьерж может править позиции заявки' };
  }
  if (!patch.category.trim() || !patch.name.trim()) {
    return { ok: false, error: 'Категория и название не могут быть пустыми' };
  }

  const supabase = await createSupabaseServerClient();

  const { data: item } = await supabase
    .from('request_items')
    .select('id, request_id, name, category, specs')
    .eq('id', itemId)
    .maybeSingle();
  if (!item) return { ok: false, error: 'Позиция не найдена' };

  const editError = await assertItemsEditable(supabase, item.request_id);
  if (editError) return { ok: false, error: editError };

  const categoryChanged = item.category !== patch.category;

  const { error: updateError } = await supabase
    .from('request_items')
    .update({ category: patch.category, name: patch.name })
    .eq('id', itemId);
  if (updateError) return { ok: false, error: updateError.message };

  if (categoryChanged) {
    const sourceText = (item.specs as { sourceText?: string } | null)?.sourceText;
    const alias = normalizeText(sourceText ?? item.name);

    await supabase.from('learning_events').insert({
      type: 'extraction_fix',
      payload: {
        requestItemId: itemId,
        itemName: item.name,
        fromCategory: item.category,
        toCategory: patch.category,
        correctedBy: user.id,
        sourceText: sourceText ?? null,
      },
    });

    const { data: existingAlias } = await supabase
      .from('extraction_aliases')
      .select('id, hits')
      .eq('alias', alias)
      .eq('kind', 'category')
      .maybeSingle();

    if (existingAlias) {
      await supabase
        .from('extraction_aliases')
        .update({ canonical: patch.category, hits: existingAlias.hits + 1, confirmed_by: user.id })
        .eq('id', existingAlias.id);
    } else {
      await supabase.from('extraction_aliases').insert({
        alias,
        canonical: patch.category,
        kind: 'category',
        hits: 1,
        confirmed_by: user.id,
      });
    }
  }

  revalidatePath(`/concierge/orders`);
  return { ok: true };
}
