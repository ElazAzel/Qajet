import { checkRequestCompleteness } from '@qajet/engine/completeness';
import { Reveal } from '@qajet/ui/motion';
import { Card } from '@qajet/ui/primitives';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  ITEMS_EDITABLE_STATES,
  ORDER_STATE_LABEL,
  type OrderState,
} from '../../../../lib/order-state';
import { ItemsList } from './_items-list';

/**
 * Экран позиций заявки для консьержа — agents.md §8A/§7.4, шаги 2-3 волны 1.
 * Раньше такого экрана не было вообще: путь консьержа от «взял в работу»
 * до «RFQ отправлен» — цепочка одиночных кнопок без единого промежуточного
 * просмотра/правки request_items. Показывает баннер Completeness Engine —
 * тот же checkRequestCompleteness, что и серверный гейт в advanceOrderStage.
 * Правка категории/названия (Classification Engine) — в _item-card.tsx,
 * пишет обучающий сигнал на сервере (item-actions.ts). Split/merge позиций
 * (Dependency Engine, шаги 6-8 волны) — там же плюс _items-list.tsx для
 * merge (объединяет несколько карточек сразу, выбор чекбоксами пересекает
 * их — состояние нужно на уровне списка).
 *
 * Доступен только до отправки RFQ: quote_lines/plan_lines ссылаются на
 * request_items с onDelete:'restrict', так что split/merge безопасны лишь
 * в этом окне — единая модель редактирования для всего экрана.
 */

const secondaryLinkClass =
  'inline-flex h-10 items-center justify-center gap-2 rounded-control border border-rule bg-surface px-4 text-sm font-medium text-ink transition-colors duration-[var(--duration-instant)] hover:bg-page';

export default async function ConciergeOrderItemsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: order } = await supabase
    .from('orders')
    .select('id, state, request_id')
    .eq('id', id)
    .maybeSingle();
  if (!order) notFound();

  const state = order.state as OrderState;
  const editable = ITEMS_EDITABLE_STATES.includes(state);

  const [{ data: requestRow }, { data: itemRows }] = await Promise.all([
    supabase
      .from('requests')
      .select('title, deadline_date, budget_kzt')
      .eq('id', order.request_id)
      .maybeSingle(),
    supabase
      .from('request_items')
      .select(
        'id, name, category, qty, unit, required_capabilities, specs, needs_clarification, clarification_reason',
      )
      .eq('request_id', order.request_id)
      .order('created_at', { ascending: true }),
  ]);

  const items = itemRows ?? [];
  const completeness = checkRequestCompleteness({
    deadlineDate: requestRow?.deadline_date ?? null,
    budgetKzt: requestRow?.budget_kzt ?? null,
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      needsClarification: item.needs_clarification,
      clarificationReason: item.clarification_reason,
    })),
  });

  return (
    <div className="max-w-3xl">
      <p className="mb-4 text-fine text-muted">
        <Link href={`/concierge/orders/${order.id}`} className="hover:text-ink">
          Заказ
        </Link>
        <span className="mx-1.5">›</span>
        <span className="font-medium text-ink">Позиции заявки</span>
      </p>

      <Reveal className="mb-6">
        <p className="text-micro tracking-wide text-muted uppercase">{ORDER_STATE_LABEL[state]}</p>
        <h1 className="mt-1 text-2xl font-extrabold text-ink">{requestRow?.title ?? 'Заявка'}</h1>
      </Reveal>

      {!editable && (
        <Reveal className="mb-6">
          <Card padding="sm" className="border-rule bg-page text-fine text-muted">
            Позиции доступны для просмотра/правки только до отправки RFQ — эта заявка уже прошла эту
            стадию.
          </Card>
        </Reveal>
      )}

      <Reveal delay={0.06} className="mb-6">
        {completeness.blockers.length === 0 ? (
          <Card padding="sm" className="bg-status-success-bg text-fine text-status-success-fg">
            Заявка готова к RFQ — блокеров нет.
          </Card>
        ) : (
          <Card padding="sm" className="bg-status-danger-bg text-fine">
            <p className="font-semibold text-status-danger-fg">Перед RFQ нужно устранить:</p>
            <ul className="mt-2 flex flex-col gap-1 text-ink">
              {completeness.blockers.map((issue, i) => (
                <li key={`${issue.code}-${i}`}>· {issue.humanReason}</li>
              ))}
            </ul>
          </Card>
        )}
        {completeness.warnings.length > 0 && (
          <p className="mt-2 text-fine text-muted">
            {completeness.warnings.map((w) => w.humanReason).join(' ')}
          </p>
        )}
      </Reveal>

      <ItemsList
        editable={editable}
        items={items.map((item) => ({
          id: item.id,
          name: item.name,
          category: item.category,
          qty: item.qty,
          unit: item.unit,
          requiredCapabilities: item.required_capabilities,
          sourceText: (item.specs as { sourceText?: string } | null)?.sourceText,
          needsClarification: item.needs_clarification,
          clarificationReason: item.clarification_reason,
        }))}
      />

      <Link href={`/concierge/orders/${order.id}`} className={`${secondaryLinkClass} mt-6`}>
        Назад к заказу
      </Link>
    </div>
  );
}
