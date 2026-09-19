'use server';

import { normalizeText } from '@qajet/engine/intake';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { type ActionResult, actionFailure } from '../action-result';
import { CATALOG_BY_KEY } from '../catalog';
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

export type { ActionResult } from '../action-result';

const itemClassificationSchema = z.object({ itemKey: z.string().trim().min(1).max(120) }).strict();
const splitPartSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    qty: z.number().positive().refine(Number.isSafeInteger),
    category: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
const splitPartsSchema = z.array(splitPartSchema).min(2).max(100);
const itemIdsSchema = z.array(z.string().uuid()).min(2).max(100);
const mergeOverridesSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    category: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

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
 * Подтверждение классификации через каталог. Каталожная позиция — единый
 * источник name/category/unit/required_capabilities/itemKey: нельзя оставить
 * старые зависимости после ручной правки только названия или категории.
 */
export async function correctItemClassification(
  itemId: string,
  patch: { itemKey: string },
): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const actor = orderActorFor(user);
  if (actor !== 'concierge' && actor !== 'admin') {
    return { ok: false, error: 'Только консьерж может править позиции заявки' };
  }
  if (!z.string().uuid().safeParse(itemId).success) {
    return { ok: false, error: 'Позиция указана некорректно' };
  }
  const parsedPatch = itemClassificationSchema.safeParse(patch);
  if (!parsedPatch.success) {
    return { ok: false, error: 'Выберите корректную позицию каталога' };
  }
  const catalogItem = CATALOG_BY_KEY.get(parsedPatch.data.itemKey);
  if (!catalogItem) {
    return { ok: false, error: 'Выбранной позиции нет в каталоге' };
  }

  const supabase = await createSupabaseServerClient();

  const { data: item } = await supabase
    .from('request_items')
    .select('id, request_id, name, category, specs, needs_clarification')
    .eq('id', itemId)
    .maybeSingle();
  if (!item) return { ok: false, error: 'Позиция не найдена' };

  const editError = await assertItemsEditable(supabase, item.request_id);
  if (editError) return { ok: false, error: editError };

  const previousItemKey = (item.specs as { itemKey?: unknown } | null)?.itemKey;
  const classificationChanged =
    item.category !== catalogItem.category || previousItemKey !== catalogItem.itemKey;

  const { error: updateError } = await supabase
    .from('request_items')
    .update({
      category: catalogItem.category,
      name: catalogItem.name,
      unit: catalogItem.unit,
      required_capabilities: catalogItem.requiredCapabilities,
      specs: { itemKey: catalogItem.itemKey },
      needs_clarification: false,
      clarification_reason: null,
    })
    .eq('id', itemId);
  if (updateError) return actionFailure('item.correctItemClassification', updateError);

  if (classificationChanged) {
    const sourceText = (item.specs as { sourceText?: string } | null)?.sourceText;
    const alias = normalizeText(sourceText ?? item.name);

    await supabase.from('learning_events').insert({
      type: 'extraction_fix',
      payload: {
        requestItemId: itemId,
        itemName: catalogItem.name,
        fromCategory: item.category,
        toCategory: catalogItem.category,
        correctedBy: user.id,
        sourceText: sourceText ?? null,
        fromItemKey: typeof previousItemKey === 'string' ? previousItemKey : null,
        toItemKey: catalogItem.itemKey,
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
        .update({
          canonical: catalogItem.category,
          hits: existingAlias.hits + 1,
          confirmed_by: user.id,
        })
        .eq('id', existingAlias.id);
    } else {
      await supabase.from('extraction_aliases').insert({
        alias,
        canonical: catalogItem.category,
        kind: 'category',
        hits: 1,
        confirmed_by: user.id,
      });
    }
  }

  revalidatePath('/concierge');
  return { ok: true };
}

/**
 * Split/merge позиций (Dependency Engine, agents.md §8A, волна 1 шаги
 * 6-8). Сама операция — RPC split_request_item/merge_request_items
 * (packages/db/migrations/0011_aromatic_deathstrike.sql): одной
 * транзакцией insert новых строк + delete исходных, каждая проверяет
 * роль вызывающего первой же строкой. Здесь — только gate по стадии
 * заказа (тот же assertItemsEditable, что и у correctItemClassification)
 * и понятная русская ошибка на очевидных случаях до похода в БД.
 */
export interface SplitPart {
  name: string;
  qty: number;
  category?: string;
}

export async function splitRequestItem(itemId: string, parts: SplitPart[]): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const actor = orderActorFor(user);
  if (actor !== 'concierge' && actor !== 'admin') {
    return { ok: false, error: 'Только консьерж может разделять позиции заявки' };
  }
  if (!z.string().uuid().safeParse(itemId).success) {
    return { ok: false, error: 'Позиция указана некорректно' };
  }
  const parsedParts = splitPartsSchema.safeParse(parts);
  if (!parsedParts.success) {
    return { ok: false, error: 'У каждой части должны быть название и целое количество больше 0' };
  }

  const supabase = await createSupabaseServerClient();

  const { data: item } = await supabase
    .from('request_items')
    .select('request_id, qty')
    .eq('id', itemId)
    .maybeSingle();
  if (!item) return { ok: false, error: 'Позиция не найдена' };

  const editError = await assertItemsEditable(supabase, item.request_id);
  if (editError) return { ok: false, error: editError };

  const partsQty = parsedParts.data.reduce((sum, part) => sum + part.qty, 0);
  if (partsQty !== item.qty) {
    return { ok: false, error: `Количество частей должно равняться исходному: ${item.qty}` };
  }

  const { error } = await supabase.rpc('split_request_item', {
    p_item_id: itemId,
    p_parts: parsedParts.data,
  });
  if (error) return actionFailure('item.splitRequestItem', error);

  revalidatePath('/concierge');
  return { ok: true };
}

export async function mergeRequestItems(
  itemIds: string[],
  overrides?: { name?: string; category?: string },
): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const actor = orderActorFor(user);
  if (actor !== 'concierge' && actor !== 'admin') {
    return { ok: false, error: 'Только консьерж может объединять позиции заявки' };
  }
  const parsedIds = itemIdsSchema.safeParse(itemIds);
  if (!parsedIds.success || new Set(parsedIds.data).size !== parsedIds.data.length) {
    return { ok: false, error: 'Выберите минимум две разные позиции' };
  }
  const parsedOverrides = mergeOverridesSchema.safeParse(overrides ?? {});
  if (!parsedOverrides.success)
    return { ok: false, error: 'Параметры объединения указаны некорректно' };

  const supabase = await createSupabaseServerClient();

  const { data: item } = await supabase
    .from('request_items')
    .select('request_id')
    .eq('id', parsedIds.data[0])
    .maybeSingle();
  if (!item) return { ok: false, error: 'Позиция не найдена' };

  const editError = await assertItemsEditable(supabase, item.request_id);
  if (editError) return { ok: false, error: editError };

  const { error } = await supabase.rpc('merge_request_items', {
    p_item_ids: parsedIds.data,
    p_name: parsedOverrides.data.name ?? null,
    p_category: parsedOverrides.data.category ?? null,
  });
  if (error) return actionFailure('item.mergeRequestItems', error);

  revalidatePath('/concierge');
  return { ok: true };
}
