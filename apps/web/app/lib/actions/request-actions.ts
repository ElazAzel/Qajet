'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { CATALOG_BY_KEY, type CatalogItem } from '../catalog';
import { orderActorFor, requireCurrentUser } from '../current-user';

/**
 * Создание заявки покупателем — agents.md §10. Пишет только requests +
 * request_items; orders для этой заявки ещё нет — концьерж заводит его
 * отдельным действием (intakeRequest, order-actions.ts), когда берёт
 * заявку в работу. До этого момента заявка существует сама по себе.
 *
 * Позиции берутся из фиксированного каталога (apps/web/app/lib/catalog.ts),
 * не из свободного текста: полноценный NLP-интейк (agents.md §14,
 * matchNomenclature/extractQuantity) — отдельный, ещё не собранный кусок
 * движка; ручной выбор из каталога даёт тот же результат в БД (реальные
 * request_items с category/requiredCapabilities) без риска, что парсер
 * угадает позицию неверно.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface CreateRequestItemInput {
  itemKey: string;
  qty: number;
}

export interface CreateRequestInput {
  title: string;
  city: string;
  description: string;
  budgetKzt?: number | undefined;
  deadlineDate?: string | undefined;
  deliveryAddress?: string | undefined;
  items: CreateRequestItemInput[];
}

export async function createRequest(
  input: CreateRequestInput,
): Promise<ActionResult & { requestId?: string }> {
  const user = await requireCurrentUser();
  if (orderActorFor(user) !== 'buyer') {
    return { ok: false, error: 'Только покупатель может создать заявку' };
  }
  if (!user.companyId) {
    return { ok: false, error: 'У пользователя нет компании' };
  }
  if (!input.title.trim()) {
    return { ok: false, error: 'Укажите название заявки' };
  }
  if (input.items.length === 0) {
    return { ok: false, error: 'Добавьте хотя бы одну позицию' };
  }

  const resolvedItems: { catalogItem: CatalogItem; qty: number }[] = [];
  for (const item of input.items) {
    const catalogItem = CATALOG_BY_KEY.get(item.itemKey);
    if (!catalogItem) return { ok: false, error: `Неизвестная позиция каталога: ${item.itemKey}` };
    if (!Number.isFinite(item.qty) || item.qty <= 0) {
      return { ok: false, error: `Некорректное количество для «${catalogItem.name}»` };
    }
    resolvedItems.push({ catalogItem, qty: Math.round(item.qty) });
  }

  const supabase = await createSupabaseServerClient();

  const { data: request, error: requestError } = await supabase
    .from('requests')
    .insert({
      buyer_company_id: user.companyId,
      created_by: user.id,
      title: input.title.trim(),
      raw_text: input.description.trim(),
      deadline_date: input.deadlineDate || null,
      budget_kzt: input.budgetKzt ?? null,
      delivery_address: input.deliveryAddress?.trim() || null,
      city: input.city,
      status: 'submitted',
    })
    .select('id')
    .single();
  if (requestError || !request) {
    return { ok: false, error: requestError?.message ?? 'Не удалось создать заявку' };
  }

  const { error: itemsError } = await supabase.from('request_items').insert(
    resolvedItems.map(({ catalogItem, qty }) => ({
      request_id: request.id,
      name: catalogItem.name,
      category: catalogItem.category,
      qty,
      unit: catalogItem.unit,
      specs: { itemKey: catalogItem.itemKey },
      required_capabilities: catalogItem.requiredCapabilities,
    })),
  );
  if (itemsError) return { ok: false, error: itemsError.message };

  revalidatePath('/buyer');
  revalidatePath('/concierge');
  return { ok: true, requestId: request.id };
}
