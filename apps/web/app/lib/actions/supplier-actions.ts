'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { orderActorFor, requireCurrentUser } from '../current-user';

/**
 * Ответ поставщика на RFQ — agents.md §10 «Поставщик». Через
 * авторизованный dashboard поставщика (демо-логин), а не через защищённую
 * ссылку без входа (agents.md §10 предполагает и такой путь) — тот
 * добавляет отдельный публичный маршрут вне текущей аутентификации,
 * оставлено как честный, ещё не закрытый пробел.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface QuoteLineInput {
  requestItemId: string;
  unitPriceKzt: number;
  leadTimeDays: number;
  setupFeeKzt?: number | undefined;
  minQty?: number | undefined;
}

export async function submitQuote(rfqId: string, lines: QuoteLineInput[]): Promise<ActionResult> {
  const user = await requireCurrentUser();
  if (orderActorFor(user) !== 'supplier') {
    return { ok: false, error: 'Только поставщик может ответить на RFQ' };
  }
  if (lines.length === 0) {
    return { ok: false, error: 'Укажите цену хотя бы по одной позиции' };
  }
  for (const line of lines) {
    if (!Number.isFinite(line.unitPriceKzt) || line.unitPriceKzt <= 0) {
      return { ok: false, error: 'Укажите корректную цену за единицу' };
    }
    if (!Number.isFinite(line.leadTimeDays) || line.leadTimeDays <= 0) {
      return { ok: false, error: 'Укажите корректный срок поставки' };
    }
  }

  const supabase = await createSupabaseServerClient();

  const { data: rfq } = await supabase
    .from('rfqs')
    .select('id, status')
    .eq('id', rfqId)
    .maybeSingle();
  if (!rfq) return { ok: false, error: 'RFQ не найден' };
  if (rfq.status !== 'sent') return { ok: false, error: 'На этот запрос уже дан ответ' };

  const { data: quote, error: quoteError } = await supabase
    .from('quotes')
    .insert({ rfq_id: rfqId, source: 'form' })
    .select('id')
    .single();
  if (quoteError || !quote)
    return { ok: false, error: quoteError?.message ?? 'Не удалось создать КП' };

  const { error: linesError } = await supabase.from('quote_lines').insert(
    lines.map((line) => ({
      quote_id: quote.id,
      request_item_id: line.requestItemId,
      unit_price_kzt: Math.round(line.unitPriceKzt),
      lead_time_days: Math.round(line.leadTimeDays),
      setup_fee_kzt: Math.round(line.setupFeeKzt ?? 0),
      min_qty: line.minQty ?? null,
      capability_confirmed: true,
    })),
  );
  if (linesError) return { ok: false, error: linesError.message };

  const { error: rfqError } = await supabase
    .from('rfqs')
    .update({ status: 'quoted' })
    .eq('id', rfqId);
  if (rfqError) return { ok: false, error: rfqError.message };

  revalidatePath('/supplier');
  revalidatePath(`/supplier/rfq/${rfqId}`);
  return { ok: true };
}

export async function declineRfq(rfqId: string): Promise<ActionResult> {
  const user = await requireCurrentUser();
  if (orderActorFor(user) !== 'supplier') {
    return { ok: false, error: 'Только поставщик может отказаться от RFQ' };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('rfqs').update({ status: 'declined' }).eq('id', rfqId);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/supplier');
  return { ok: true };
}

/**
 * Подтверждение стадии поставщиком — agents.md §10 «Поставщик → статусы,
 * которые он подтверждает сам». До этого все операционные стадии двигал
 * только консьерж: «взял в производство» и «отгрузил» попадали в систему
 * пересказом и с задержкой, хотя первым о них узнаёт поставщик.
 *
 * Запись идёт через RPC `supplier_confirm_stage` (миграция 0020), а не
 * прямым update: RLS не умеет ограничивать целевое значение, и политика
 * «поставщик может UPDATE своих заказов» дала бы ему выставить любое
 * состояние, до которого из текущего есть ребро — включая cancelled. Та
 * же причина, по которой approvePlan() ходит в approve_plan().
 *
 * Функция сама пишет и `order_stage_events`: политика на эту таблицу
 * поставщика не пускает, и расширять её значило бы дать ему писать в
 * таймлайн произвольные события.
 */
export async function confirmSupplierStage(
  orderId: string,
  toState: string,
): Promise<ActionResult> {
  const user = await requireCurrentUser();
  if (orderActorFor(user) !== 'supplier') {
    return { ok: false, error: 'Только поставщик подтверждает эти стадии' };
  }
  if (toState !== 'in_production' && toState !== 'shipped') {
    return { ok: false, error: 'Эту стадию поставщик не подтверждает' };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('supplier_confirm_stage', {
    p_order_id: orderId,
    p_to_state: toState,
  });
  if (error) return { ok: false, error: 'Не удалось подтвердить стадию' };

  revalidatePath('/supplier');
  revalidatePath('/supplier/orders');
  return { ok: true };
}

export interface SupplierProfileInput {
  minOrderKzt: number | null;
  leadTimeDaysDefault: number | null;
  portfolioUrls: string[];
  notes: string | null;
}

/**
 * Правка профиля поставщика — agents.md §10 «Поставщик → профиль и
 * портфолио». `supplier_profiles_update_own` уже ограничивает запись
 * своей компанией (миграция схемы с самого начала) — прямой update без
 * RPC достаточен, в отличие от approve_plan/supplier_confirm_stage, где
 * решение зависит от чужих данных (плана, лимита), а не только от
 * принадлежности строки.
 *
 * `categories`/`capabilities` не в форме намеренно: это словарь, по
 * которому работает матчер (packages/engine/src/match), правка мимо
 * согласованного списка тихо выбила бы поставщика из подбора.
 */
export async function updateSupplierProfile(input: SupplierProfileInput): Promise<ActionResult> {
  const user = await requireCurrentUser();
  if (orderActorFor(user) !== 'supplier') {
    return { ok: false, error: 'Только поставщик может править свой профиль' };
  }
  if (
    input.minOrderKzt !== null &&
    (!Number.isFinite(input.minOrderKzt) || input.minOrderKzt < 0)
  ) {
    return { ok: false, error: 'Минимальная сумма заказа указана неверно' };
  }
  if (
    input.leadTimeDaysDefault !== null &&
    (!Number.isFinite(input.leadTimeDaysDefault) || input.leadTimeDaysDefault <= 0)
  ) {
    return { ok: false, error: 'Срок поставки указан неверно' };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('supplier_profiles')
    .update({
      min_order_kzt: input.minOrderKzt,
      lead_time_days_default: input.leadTimeDaysDefault,
      portfolio_urls: input.portfolioUrls,
      notes: input.notes,
    })
    .eq('company_id', user.companyId ?? '');
  if (error) return { ok: false, error: error.message };

  revalidatePath('/supplier/profile');
  return { ok: true };
}
