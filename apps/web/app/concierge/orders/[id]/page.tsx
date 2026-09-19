import type { CombinedPlan, PlanKind } from '@qajet/engine/combine';
import { nextStatesFor } from '@qajet/engine/order';
import { calculateSettlement } from '@qajet/engine/settlement';
import { BarGrow, type BarSegment, Reveal, Stagger, Stamp } from '@qajet/ui/motion';
import { Card, formatKzt, Money } from '@qajet/ui/primitives';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  loadCommissionSuggestions,
  loadPlanLinesForConcierge,
} from '../../../lib/actions/plan-actions';
import { loadRequestComparison } from '../../../lib/comparison';
import { type OrderActor, orderActorFor, requireCurrentUser } from '../../../lib/current-user';
import { loadOrderNotes, type OrderNote } from '../../../lib/order-notes';
import {
  ITEMS_EDITABLE_STATES,
  ORDER_STATE_LABEL,
  ORDER_STATE_TONE,
  type OrderState,
  PLAN_EDITABLE_STATES,
} from '../../../lib/order-state';
import { loadOrderTime, type StageTime } from '../../../lib/order-time';
import { supplierCountLabel } from '../../../lib/pluralize';
import { createRfqResponseToken } from '../../../lib/rfq-response';
import { ConciergeAssignment } from './_assignment-form';
import { PrepaymentActions, SettlementActions, SupplierPayoutActions } from './_financial-actions';
import { OrderNotes } from './_order-notes';
import { PlanChangeActions } from './_plan-change-actions';
import { PlanLinesReview } from './_plan-lines';
import { ProposePlanButton } from './_propose-plan-button';
import { StageAdvanceButton } from './_stage-advance-button';
import { TimeTracking } from './_time-tracking';

/**
 * Экран сравнения вариантов — agents.md §8D, §12, фаза 4: «сюда уходит
 * больше всего времени на дизайн», «это и есть максимально работающий
 * прототип». Сравнение использует входные КП на стадии quotes_received;
 * остальные стадии показывают отдельную панель текущего состояния с
 * доступными действиями, ссылками и учётом времени.
 */

const PLAN_LABEL: Record<PlanKind, string> = {
  recommended: 'Рекомендованный',
  cheaper: 'Дешевле',
  more_slack: 'С запасом по сроку',
};

const PLAN_SCREEN_STATES: readonly OrderState[] = [
  ...PLAN_EDITABLE_STATES,
  'estimated',
  'plan_approved',
  'on_hold',
  'accepted',
];

export default async function ConciergeOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const user = await requireCurrentUser();
  const actor = orderActorFor(user);
  const canPropose = actor === 'concierge' || actor === 'admin';

  const { data: order } = await supabase
    .from('orders')
    .select('id, state, request_id, approved_plan_id, concierge_user_id')
    .eq('id', id)
    .maybeSingle();
  if (!order) notFound();

  const state = order.state as OrderState;
  const { data: conciergeRows } = canPropose
    ? await supabase
        .from('users')
        .select('id, full_name, role')
        .in('role', ['concierge', 'admin'])
        .eq('is_active', true)
        .is('company_id', null)
        .order('full_name', { ascending: true })
    : { data: [] };
  const assignment = canPropose ? (
    <ConciergeAssignment
      orderId={order.id}
      currentUserId={order.concierge_user_id}
      options={(conciergeRows ?? []).map((row) => ({
        id: row.id,
        fullName: row.full_name,
        role: row.role,
      }))}
    />
  ) : null;
  // Учёт времени по стадиям (agents.md §10 «Консьерж») показывается на любой
  // стадии заказа, а не только там, где есть экран сравнения: работа идёт
  // весь жизненный цикл, и §9 называет её функцией первого класса.
  const timeStages = canPropose ? await loadOrderTime(supabase, order.id) : [];
  const orderNotes = canPropose ? await loadOrderNotes(supabase, order.id) : [];

  if (PLAN_SCREEN_STATES.includes(state)) {
    return (
      <>
        <PlanLinesScreen
          orderId={order.id}
          planId={order.approved_plan_id}
          state={state}
          actor={actor}
        />
        {assignment}
        {canPropose && (
          <div className="mt-6 flex max-w-md flex-col gap-4">
            <TimeTracking orderId={order.id} currentState={state} stages={timeStages} />
            <OrderNotes orderId={order.id} notes={orderNotes} />
          </div>
        )}
      </>
    );
  }

  if (state !== 'quotes_received') {
    const nextStates = nextStatesFor(state, actor);
    const rfqLinks =
      state === 'rfq_sent' ? await loadRfqResponseLinks(supabase, order.request_id) : [];
    return (
      <>
        <OrderStagePanel
          state={state}
          orderId={order.id}
          nextStates={nextStates}
          timeStages={timeStages}
          notes={orderNotes}
          rfqLinks={rfqLinks}
        />
        {assignment}
      </>
    );
  }

  const comparison = await loadRequestComparison(supabase, order.request_id);
  if (!comparison || comparison.result.plans.length === 0) {
    return (
      <>
        {assignment}
        <OrderStagePanel
          state={state}
          orderId={order.id}
          note="Ни один вариант не прошёл допустимость — все КП отбракованы."
          timeStages={timeStages}
          notes={orderNotes}
        />
      </>
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
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-fine font-semibold">
          <Link
            href={`/concierge/orders/${order.id}/messages`}
            className="text-purple hover:underline"
          >
            Переписка заказа →
          </Link>
          <Link
            href={`/concierge/orders/${order.id}/quotes`}
            className="text-purple hover:underline"
          >
            Все версии КП →
          </Link>
        </div>
      </Reveal>
      {assignment}

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
      {canPropose && (
        <Reveal className="mt-6 flex max-w-md flex-col gap-4">
          <TimeTracking orderId={order.id} currentState={state} stages={timeStages} />
          <OrderNotes orderId={order.id} notes={orderNotes} />
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
            {plan.supplierCount} {supplierCountLabel(plan.supplierCount)} ·{' '}
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

/**
 * Позиции утверждённого плана — задача «комиссия платформы»: раньше здесь
 * (state !== quotes_received) раньше не было экрана с plan_lines вообще.
 * Показывает цену
 * поставщика + комиссию по каждой строке (staff-контекст, покупатель
 * этого не видит — apps/web/app/buyer/orders/[id]/page.tsx показывает
 * только общий итог) и позволяет точечно менять % — 21-24%,
 * packages/engine/src/commission.
 */
async function PlanLinesScreen({
  orderId,
  planId,
  state,
  actor,
}: {
  orderId: string;
  planId: string;
  state: OrderState;
  actor: OrderActor;
}) {
  const supabase = await createSupabaseServerClient();
  const { data: plan } = await supabase
    .from('plans')
    .select('id, total_kzt')
    .eq('id', planId)
    .maybeSingle();

  if (!plan) {
    return (
      <OrderStagePanel state={state} orderId={orderId} nextStates={nextStatesFor(state, actor)} />
    );
  }

  const [lines, suggestions] = await Promise.all([
    loadPlanLinesForConcierge(supabase, plan.id),
    loadCommissionSuggestions(supabase),
  ]);
  const { data: changeRequests } = await supabase
    .from('change_requests')
    .select('id, status, diff, created_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(10);

  const { data: paymentRows } = await supabase
    .from('payment_facts')
    .select('direction, kind, amount_kzt')
    .eq('order_id', orderId)
    .eq('status', 'confirmed')
    .in('kind', ['prepayment', 'surcharge', 'refund']);
  let receivedKzt = 0;
  let refundedKzt = 0;
  for (const payment of paymentRows ?? []) {
    if (payment.direction === 'inbound') receivedKzt += payment.amount_kzt;
    if (payment.direction === 'outbound' && payment.kind === 'refund') {
      refundedKzt += payment.amount_kzt;
    }
  }
  const settlement = calculateSettlement(plan.total_kzt, receivedKzt - refundedKzt);

  const nextStates = nextStatesFor(state, actor);
  const { data: payoutRows } = await supabase
    .from('plan_lines')
    .select('supplier_company_id, line_total_kzt, companies(name)')
    .eq('plan_id', plan.id)
    .order('created_at', { ascending: true });
  const suppliersById = new Map<
    string,
    { supplierCompanyId: string; supplierName: string; expectedAmountKzt: number }
  >();
  for (const row of payoutRows ?? []) {
    const company = Array.isArray(row.companies) ? row.companies[0] : row.companies;
    const current = suppliersById.get(row.supplier_company_id);
    suppliersById.set(row.supplier_company_id, {
      supplierCompanyId: row.supplier_company_id,
      supplierName: current?.supplierName ?? company?.name ?? 'Поставщик',
      expectedAmountKzt: (current?.expectedAmountKzt ?? 0) + row.line_total_kzt,
    });
  }
  const suppliers = [...suppliersById.values()];

  return (
    <div className="max-w-3xl">
      <Reveal className="mb-6">
        <p className="text-micro tracking-wide text-muted uppercase">
          Позиции плана · {ORDER_STATE_LABEL[state]}
        </p>
        <h1 className="mt-1 text-2xl font-extrabold text-ink">Комиссия по позициям</h1>
        <p className="mt-1 text-sm text-muted">
          По умолчанию 23% на каждую позицию — можно точечно менять, 21-24%, по объёму и сложности
          исполнения.
        </p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-fine font-semibold">
          <Link
            href={`/concierge/orders/${orderId}/messages`}
            className="text-purple hover:underline"
          >
            Переписка заказа →
          </Link>
          <Link
            href={`/concierge/orders/${orderId}/quotes`}
            className="text-purple hover:underline"
          >
            Все версии КП →
          </Link>
        </div>
      </Reveal>

      <PlanLinesReview
        lines={lines}
        suggestions={Object.fromEntries(suggestions)}
        totalKzt={plan.total_kzt}
      />

      {(changeRequests ?? [])
        .filter((change) => change.status === 'pending')
        .map((change) => {
          const diff = (change.diff ?? {}) as {
            reason?: unknown;
            requestedSupplierDeltaKzt?: unknown;
            requestedDeliveryDeltaKzt?: unknown;
          };
          return (
            <Card key={change.id} padding="sm" className="mt-6 border-status-warning-fg/30">
              <p className="text-sm font-bold text-ink">Запрос изменения условий</p>
              <p className="mt-1 text-fine text-muted">
                {typeof diff.reason === 'string' ? diff.reason : 'Без комментария'}
              </p>
              <p className="mt-2 text-fine text-muted">
                Закупка: {Number(diff.requestedSupplierDeltaKzt ?? 0).toLocaleString('ru-RU')} ₸ ·{' '}
                доставка: {Number(diff.requestedDeliveryDeltaKzt ?? 0).toLocaleString('ru-RU')} ₸
              </p>
              <PlanChangeActions changeRequestId={change.id} />
            </Card>
          );
        })}

      {state === 'estimated' ? (
        <PrepaymentActions orderId={orderId} />
      ) : (
        <>
          {(state === 'plan_approved' || state === 'on_hold') && (
            <SupplierPayoutActions orderId={orderId} suppliers={suppliers} />
          )}
          {state === 'accepted' && (
            <SettlementActions
              orderId={orderId}
              kind={settlement.kind}
              amountKzt={settlement.amountKzt}
            />
          )}
          {nextStates.filter((toState) => toState !== 'suppliers_paid').length > 0 && (
            <div className="mt-6 flex flex-wrap items-start gap-3">
              {nextStates
                .filter((toState) => toState !== 'suppliers_paid')
                .map((toState, i) => (
                  <StageAdvanceButton
                    key={toState}
                    orderId={orderId}
                    toState={toState}
                    primary={i === 0}
                  />
                ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function OrderStagePanel({
  state,
  note,
  orderId,
  nextStates = [],
  timeStages = [],
  notes = [],
  rfqLinks = [],
}: {
  state: OrderState;
  note?: string;
  orderId?: string;
  nextStates?: OrderState[];
  timeStages?: StageTime[];
  notes?: OrderNote[];
  rfqLinks?: { id: string; supplierName: string; token: string }[];
}) {
  return (
    <Reveal className="flex max-w-md flex-col gap-3 py-16">
      <Stamp tone={ORDER_STATE_TONE[state]} className="w-fit">
        {ORDER_STATE_LABEL[state]}
      </Stamp>
      <h1 className="text-lg font-bold text-ink">Текущая стадия заказа</h1>
      <p className="text-sm text-muted">
        {note ??
          'Для этой стадии доступны действия ниже. Сравнение исполнений показывается на шаге «КП получены», а здесь сохраняются переходы, ссылки поставщикам и рабочее время.'}
      </p>
      {orderId && timeStages !== undefined && (
        <div className="mt-4 flex w-full max-w-md flex-col gap-4">
          <TimeTracking orderId={orderId} currentState={state} stages={timeStages} />
          {notes && <OrderNotes orderId={orderId} notes={notes} />}
        </div>
      )}
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
      {rfqLinks.length > 0 && (
        <div className="mt-4 rounded-card border border-rule bg-surface p-4">
          <p className="text-fine font-semibold text-ink">Ссылки поставщикам</p>
          <p className="mt-1 text-micro text-muted">
            Временные ссылки на быстрый ответ RFQ. Передавайте только адресату.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {rfqLinks.map((link) => (
              <li key={link.id}>
                <a
                  href={`/rfq/respond/${link.token}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-fine font-semibold text-purple hover:underline"
                >
                  {link.supplierName} → открыть RFQ
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {orderId && (state === 'rfq_sent' || state === 'quotes_received') && (
        <Link
          href={`/concierge/orders/${orderId}/quotes`}
          className="mt-1 text-fine font-medium text-purple hover:underline"
        >
          Проверить КП и запросить исправление →
        </Link>
      )}
      {orderId && (
        <Link
          href={`/concierge/orders/${orderId}/messages`}
          className="mt-1 text-fine font-medium text-purple hover:underline"
        >
          Открыть переписку заказа →
        </Link>
      )}
      {orderId && ITEMS_EDITABLE_STATES.includes(state) && (
        <Link
          href={`/concierge/orders/${orderId}/items`}
          className="mt-1 text-fine font-medium text-purple hover:underline"
        >
          Проверить позиции заявки →
        </Link>
      )}
    </Reveal>
  );
}

async function loadRfqResponseLinks(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  requestId: string,
): Promise<{ id: string; supplierName: string; token: string }[]> {
  const { data } = await supabase
    .from('rfqs')
    .select('id, token, companies(name)')
    .eq('request_id', requestId)
    .eq('status', 'sent');
  if (!data) return [];

  try {
    return data.map((row) => {
      const company = Array.isArray(row.companies) ? row.companies[0] : row.companies;
      return {
        id: row.id,
        supplierName: company?.name ?? 'Поставщик',
        token: createRfqResponseToken(row.id, row.token),
      };
    });
  } catch {
    // Production deliberately fails closed when LINK_SIGNING_SECRET is absent.
    return [];
  }
}
