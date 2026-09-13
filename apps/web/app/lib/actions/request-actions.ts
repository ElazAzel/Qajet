'use server';

import { findRestrictedCategory, restrictedCategoryMessage } from '@qajet/engine/compliance';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { CATALOG_BY_KEY, type CatalogItem } from '../catalog';
import { orderActorFor, requireCurrentUser } from '../current-user';

/**
 * Создание заявки покупателем — agents.md §10. Пишет только requests +
 * request_items; orders для этой заявки ещё нет — консьерж заводит его
 * отдельным действием (intakeRequest, order-actions.ts), когда берёт
 * заявку в работу. До этого момента заявка существует сама по себе.
 *
 * Позиции можно выбрать из фиксированного каталога или добавить через
 * подтверждённый разбор свободного текста в intake-actions.ts. В обоих
 * случаях в БД попадают реальные request_items с category и
 * requiredCapabilities; неоднозначный результат парсера не проходит без
 * явного подтверждения покупателя.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface CreateRequestItemInput {
  itemKey: string;
  qty: number;
  /** Исходная фраза, если позиция добавлена через быстрый разбор текста
   *  (@qajet/engine/intake) — сохраняется в specs.sourceText, чтобы
   *  консьерж видел, из чего резолвнута позиция, при правке категории. */
  sourceText?: string | undefined;
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

const safeKztSchema = z
  .number()
  .finite()
  .nonnegative()
  .refine(Number.isSafeInteger, 'Число должно быть целым');
const positiveQuantitySchema = z
  .number()
  .finite()
  .positive()
  .refine(Number.isSafeInteger, 'Количество должно быть целым');
const createRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    city: z.string().trim().min(1).max(120),
    description: z.string().max(5000),
    budgetKzt: safeKztSchema.optional(),
    deadlineDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    deliveryAddress: z.string().trim().max(500).optional(),
    items: z
      .array(
        z
          .object({
            itemKey: z.string().trim().min(1).max(120),
            qty: positiveQuantitySchema,
            sourceText: z.string().max(500).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

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
  const parsedInput = createRequestSchema.safeParse(input);
  if (!parsedInput.success) return { ok: false, error: 'Данные заявки указаны некорректно' };
  const requestInput = parsedInput.data;

  // Жёсткий фильтр категорий (agents.md §11.5) — именно здесь, в валидаторе
  // на сервере, а не подсказкой в интерфейсе: клиентскую проверку можно
  // обойти, отправив запрос напрямую. Позиции берутся из фиксированного
  // каталога, где регулируемых категорий нет вовсе, поэтому проверяется
  // свободный текст — название и описание заявки.
  const restricted = findRestrictedCategory(requestInput.title, requestInput.description);
  if (restricted) {
    return { ok: false, error: restrictedCategoryMessage(restricted) };
  }

  const resolvedItems: {
    catalogItem: CatalogItem;
    qty: number;
    sourceText?: string | undefined;
  }[] = [];
  for (const item of requestInput.items) {
    const catalogItem = CATALOG_BY_KEY.get(item.itemKey);
    if (!catalogItem) return { ok: false, error: `Неизвестная позиция каталога: ${item.itemKey}` };
    resolvedItems.push({ catalogItem, qty: item.qty, sourceText: item.sourceText });
  }

  const supabase = await createSupabaseServerClient();

  const { data: requestId, error: requestError } = await supabase.rpc('create_request_with_items', {
    p_title: requestInput.title,
    p_raw_text: requestInput.description.trim(),
    p_deadline_date: requestInput.deadlineDate || null,
    p_budget_kzt: requestInput.budgetKzt ?? null,
    p_delivery_address: requestInput.deliveryAddress?.trim() || null,
    p_city: requestInput.city,
    p_items: resolvedItems.map(({ catalogItem, qty, sourceText }) => ({
      name: catalogItem.name,
      category: catalogItem.category,
      qty,
      unit: catalogItem.unit,
      specs: sourceText
        ? { itemKey: catalogItem.itemKey, sourceText }
        : { itemKey: catalogItem.itemKey },
      required_capabilities: catalogItem.requiredCapabilities,
    })),
  });
  if (requestError || !requestId) {
    return { ok: false, error: requestError?.message ?? 'Не удалось создать заявку' };
  }

  revalidatePath('/buyer');
  revalidatePath('/concierge');
  return { ok: true, requestId: requestId as string };
}

/**
 * Повтор заказа в один клик с новым количеством (agents.md §10) — обёртка
 * над `createRequest()`, а не второй путь записи: та же проверка роли, те
 * же `request_items` с категорией и техпроцессами из каталога.
 *
 * Город и адрес доставки берутся из последней заявки этой компании, а не
 * спрашиваются заново: повтор — это ровно «то же самое, только другой
 * тираж», и заставлять покупателя вводить адрес во второй раз значит
 * превращать один клик в форму.
 */
export async function reorderItem(
  itemKey: string,
  qty: number,
): Promise<ActionResult & { requestId?: string }> {
  const catalogItem = CATALOG_BY_KEY.get(itemKey);
  if (!catalogItem) return { ok: false, error: 'Позиции больше нет в каталоге' };

  const supabase = await createSupabaseServerClient();
  const { data: previous } = await supabase
    .from('requests')
    .select('city, delivery_address')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return createRequest({
    title: `${catalogItem.name} — повтор`,
    city: previous?.city ?? 'Алматы',
    description: `Повтор заказа: ${catalogItem.name} — ${qty} ${catalogItem.unit}.`,
    deliveryAddress: previous?.delivery_address ?? undefined,
    items: [{ itemKey, qty }],
  });
}
