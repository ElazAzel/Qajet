import type { CombinedPlan, PlanKind } from '@qajet/engine/combine';
import { nextStatesFor } from '@qajet/engine/order';
import { BarGrow, type BarSegment, Reveal, Stagger, Stamp } from '@qajet/ui/motion';
import { Card, formatKzt, Money } from '@qajet/ui/primitives';
import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { loadRequestComparison } from '../../../lib/comparison';
import { orderActorFor, requireCurrentUser } from '../../../lib/current-user';
import { ORDER_STATE_LABEL, ORDER_STATE_TONE, type OrderState } from '../../../lib/order-state';
import { ProposePlanButton } from './_propose-plan-button';
import { StageAdvanceButton } from './_stage-advance-button';

/**
 * Экран сравнения вариантов — agents.md §8D, §12, фаза 4: «сюда уходит
 * больше всего времени на дизайн», «это и есть максимально работающий
 * прототип». Сейчас покрыта только стадия quotes_received — единственная,
 * где есть входные КП для combine(); для остальных стадий честный
 * заглушечный экран вместо притворства, что тут уже что-то есть.
 */

const PLAN_LABEL: Record<PlanKind, string> = {
  recommended: 'Рекомендованный',
  cheaper: 'Дешевле',
  more_slack: 'С запасом по сроку',
};

export default async function ConciergeOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const user = await requireCurrentUser();
  const actor = orderActorFor(user);
  const canPropose = actor === 'concierge' || actor === 'admin';

  const { data: order } = await supabase
    .from('orders')
    .select('id, state, request_id')
    .eq('id', id)
    .maybeSingle();
  if (!order) notFound();

  const state = order.state as OrderState;

  if (state !== 'quotes_received') {
    const nextStates = nextStatesFor(state, actor);
    return <NotComparableYet state={state} orderId={order.id} nextStates={nextStates} />;
  }

  const comparison = await loadRequestComparison(supabase, order.request_id);
  if (!comparison || comparison.result.plans.length === 0) {
    return (
      <NotComparableYet
        state={state}
        note="Ни один вариант не прошёл допустимость — все КП отбракованы."
      />
    );
  }

  const { requestTitle, deadlineDate, items, offerSupplierNames, result } = comparison;
  const maxTotalKzt = Math.max(...result.plans.map((p) => p.totalKzt));
  const itemNameById = new Map(items.map((item) => [item.id, item.name]));

  return (
    <div className="max-w-3xl">
      <Reveal>
        <p className="text-micro tracking-wide text-muted uppercase">
          Экран сравнения · quotes_received
        </p>
        <h1 className="mt-1 text-2xl font-extrabold text-ink">{requestTitle}</h1>
        <p className="mt-1 text-sm text-muted">
          Дедлайн {deadlineDate ?? '—'} · {items.length} позиций · рассмотрено{' '}
          {result.plans[0]?.explanation.comparedOffersCount ?? 0} предложений, отсеяно{' '}
          {result.rejections.length}
        </p>
      </Reveal>

      <Stagger startIndex={1} className="mt-6 flex flex-col gap-4">
        {result.plans.map((plan) => (
          <PlanCard
            key={plan.kind}
            plan={plan}
            maxTotalKzt={maxTotalKzt}
            action={
              canPropose ? (
                <ProposePlanButton requestId={order.request_id} kind={plan.kind} />
              ) : null
            }
          />
        ))}
      </Stagger>

      {result.rejections.length > 0 && (
        <Reveal className="mt-8">
          <h2 className="text-sm font-bold text-ink">
            Журнал отбраковки — рассмотрели {result.plans[0]?.explanation.comparedOffersCount ?? 0}{' '}
            предложений, отсеяли {result.rejections.length}
          </h2>
          <ul className="mt-3 flex flex-col gap-2">
            {result.rejections.map((rejection) => (
              <li
                key={`${rejection.requestItemId}-${rejection.offerId}`}
                className="rounded-card-sm border border-rule bg-surface px-4 py-3 text-fine"
              >
                <span className="font-semibold text-ink">
                  {itemNameById.get(rejection.requestItemId) ?? rejection.requestItemId}
                </span>
                <span className="text-muted">
                  {' '}
                  · {offerSupplierNames.get(rejection.offerId) ?? 'поставщик'}
                </span>
                <p className="mt-1 text-muted">{rejection.reasonHuman}</p>
              </li>
            ))}
          </ul>
        </Reveal>
      )}
    </div>
  );
}

function PlanCard({
  plan,
  maxTotalKzt,
  action,
}: {
  plan: CombinedPlan;
  maxTotalKzt: number;
  action?: React.ReactNode;
}) {
  const segments: BarSegment[] = [
    {
      key: 'goods',
      label: 'Товары и работы',
      color: 'ink',
      fraction: plan.totalSupplierKzt / maxTotalKzt,
      amountLabel: formatKzt(plan.totalSupplierKzt),
    },
    {
      key: 'delivery',
      label: 'Доставка',
      color: 'muted',
      fraction: plan.deliveryKzt / maxTotalKzt,
      amountLabel: formatKzt(plan.deliveryKzt),
    },
    {
      key: 'commission',
      label: 'Комиссия QAJET',
      color: 'purple',
      fraction: plan.commissionKzt / maxTotalKzt,
      amountLabel: formatKzt(plan.commissionKzt),
    },
  ];
  if (plan.taxEffectKzt > 0) {
    segments.push({
      key: 'tax',
      label: 'Налоговый эффект СНР',
      color: 'signal',
      fraction: plan.taxEffectKzt / maxTotalKzt,
      amountLabel: formatKzt(plan.taxEffectKzt),
    });
  }

  return (
    <Card padding="sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <span className="text-fine font-semibold text-muted">{PLAN_LABEL[plan.kind]}</span>
          <p className="mt-0.5 text-xl font-extrabold text-ink">
            <Money amountKzt={plan.totalKzt} />
          </p>
        </div>
        <div className="text-right text-fine text-muted">
          <p>
            Срок ~{Math.round(plan.etaDays)} дн. · запас {plan.slackDays} дн.
          </p>
          <p>
            {plan.supplierCount} {plan.supplierCount === 1 ? 'поставщик' : 'поставщика'} ·{' '}
            {plan.method === 'exact' ? 'точный перебор' : 'эвристика'}
          </p>
        </div>
      </div>

      <BarGrow segments={segments} index={0} className="mt-4" />

      <div className="mt-4 flex flex-col gap-1.5">
        {plan.explanation.decomposition.map((line) => (
          <div key={line.label} className="flex items-center justify-between text-fine">
            <span className="text-muted">{line.label}</span>
            <span className="numeric text-ink">{formatKzt(line.amountKzt ?? 0)}</span>
          </div>
        ))}
        {plan.taxEffectKzt > 0 && (
          <div className="flex items-center justify-between border-t border-rule pt-1.5 text-fine">
            <span className="text-signal">Налоговый эффект СНР (не в цене варианта)</span>
            <span className="numeric text-signal">+{formatKzt(plan.taxEffectKzt)}</span>
          </div>
        )}
      </div>

      {action}
    </Card>
  );
}

function NotComparableYet({
  state,
  note,
  orderId,
  nextStates = [],
}: {
  state: OrderState;
  note?: string;
  orderId?: string;
  nextStates?: OrderState[];
}) {
  return (
    <Reveal className="flex max-w-md flex-col gap-3 py-16">
      <Stamp tone={ORDER_STATE_TONE[state]} className="w-fit">
        {ORDER_STATE_LABEL[state]}
      </Stamp>
      <h1 className="text-lg font-bold text-ink">
        Экран сравнения пока только для стадии «КП получены»
      </h1>
      <p className="text-sm text-muted">
        {note ??
          'Этот заказ на другой стадии жизненного цикла — раскладка вариантов появляется один раз, сразу после получения предложений от поставщиков, и уже неактуальна после того, как план утверждён.'}
      </p>
      {orderId && nextStates.length > 0 && (
        <div className="mt-2 flex flex-wrap items-start gap-3">
          {nextStates.map((toState, i) => (
            <StageAdvanceButton
              key={toState}
              orderId={orderId}
              toState={toState}
              primary={i === 0}
            />
          ))}
        </div>
      )}
    </Reveal>
  );
}
