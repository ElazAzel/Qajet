import { nextStatesFor } from '@qajet/engine/order';
import { Reveal, Stamp } from '@qajet/ui/motion';
import { Card, formatKzt, Money } from '@qajet/ui/primitives';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { loadBuyerOrder } from '../../../lib/buyer-order';
import { orderActorFor, requireCurrentUser } from '../../../lib/current-user';
import { ORDER_STATE_LABEL, ORDER_STATE_TONE } from '../../../lib/order-state';
import { supplierCountLabel } from '../../../lib/pluralize';
import { AttachmentForm } from '../../messages/_attachment-form';
import { BuyerIssueActions } from './_issue-actions';
import {
  AcceptDeliveryCta,
  ApprovePlanCta,
  CloseOrderForm,
  SupplierRatingForm,
} from './_order-actions';
import { PlanAlternativeSelector } from './_plan-alternatives';
import { PlanChangeForm } from './_plan-change-form';
import { ShareOrderButton } from './_share-order-button';

const PLAN_LABEL: Record<string, string> = {
  recommended: 'Рекомендованный',
  cheaper: 'Дешевле',
  more_slack: 'С запасом по сроку',
};

const DOCUMENT_LABEL: Record<string, string> = {
  prepay_invoice: 'Счёт на предоплату',
  act: 'Акт выполненных работ',
  final_invoice: 'Итоговый счёт',
};

export default async function BuyerOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const [user, order] = await Promise.all([requireCurrentUser(), loadBuyerOrder(supabase, id)]);
  if (!order) notFound();

  const actor = orderActorFor(user);
  const nextForBuyer = nextStatesFor(order.state, actor);
  const canApprove = actor === 'buyer' && nextForBuyer.includes('plan_approved');
  const canAccept = actor === 'buyer' && nextForBuyer.includes('accepted');
  const canClose = actor === 'buyer' && nextForBuyer.includes('closed');
  const canCancel = actor === 'buyer' && nextForBuyer.includes('cancelled');
  const canDispute = actor === 'buyer' && nextForBuyer.includes('disputed');
  const { data: changeRequests } = await supabase
    .from('change_requests')
    .select('id, status, diff, created_at')
    .eq('order_id', order.id)
    .order('created_at', { ascending: false })
    .limit(10);
  const pendingChange = changeRequests?.find((change) => change.status === 'pending');
  const [{ data: documents }, { data: attachments }] = await Promise.all([
    supabase
      .from('documents')
      .select('id, type, url, created_at')
      .eq('order_id', order.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('attachments')
      .select('id, file_name, size_bytes, kind, created_at')
      .eq('order_id', order.id)
      .order('created_at', { ascending: false }),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <Reveal>
        <div className="flex items-start justify-between gap-4">
          <div>
            <Stamp tone={ORDER_STATE_TONE[order.state]} className="w-fit">
              {ORDER_STATE_LABEL[order.state]}
            </Stamp>
            <h1 className="mt-2 text-2xl font-extrabold text-ink">{order.requestTitle}</h1>
          </div>
          <ShareOrderButton orderId={order.id} title={order.requestTitle} />
        </div>
      </Reveal>

      {order.plan && order.plan.status !== 'draft' && (
        <Reveal className="mt-6" from="up">
          <Card padding="sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <span className="text-fine font-semibold text-muted">
                  {PLAN_LABEL[order.plan.kind] ?? order.plan.kind}
                </span>
                <p className="mt-0.5 text-xl font-extrabold text-ink">
                  <Money amountKzt={order.plan.totalKzt} />
                </p>
              </div>
              <div className="text-right text-fine text-muted">
                <p>
                  Срок {order.plan.etaDate ?? '—'} · запас {order.plan.slackDays ?? '—'} дн.
                </p>
                <p>
                  {order.plan.supplierCount} {supplierCountLabel(order.plan.supplierCount)}
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-fine">
                <span className="text-muted">Доставка</span>
                <span className="numeric text-ink">{formatKzt(order.plan.deliveryKzt)}</span>
              </div>
              {order.plan.supplierRebateKzt > 0 && (
                <div className="flex items-center justify-between text-fine">
                  <span className="text-muted">Дополнительное вознаграждение поставщика</span>
                  <span className="numeric text-ink">
                    {formatKzt(order.plan.supplierRebateKzt)}
                  </span>
                </div>
              )}
            </div>

            {canApprove && (
              <div className="mt-4">
                <ApprovePlanCta orderId={order.id} />
              </div>
            )}
            {(order.state === 'plan_approved' || order.state === 'on_hold') && !pendingChange && (
              <PlanChangeForm orderId={order.id} />
            )}
            {pendingChange && (
              <p className="mt-4 border-rule border-t pt-4 text-fine text-muted">
                Запрос изменения условий передан QAJET и ожидает решения.
              </p>
            )}
            <Link
              href={`/buyer/orders/${order.id}/changes`}
              className="mt-4 inline-block text-fine font-semibold text-purple hover:underline"
            >
              История изменений условий →
            </Link>
            {canApprove && order.plan && (
              <PlanAlternativeSelector
                orderId={order.id}
                currentPlanId={order.plan.id}
                alternatives={order.alternatives}
              />
            )}
          </Card>
        </Reveal>
      )}

      {order.rejections.length > 0 && (
        <Reveal className="mt-6" from="up">
          <Card padding="sm">
            <p className="text-sm font-bold text-ink">Что не прошло и почему</p>
            <p className="mt-1 text-fine text-muted">
              Предложения, отбракованные при сборке плана. Причины — по существу; кто именно
              предлагал, подбирает и проверяет QAJET.
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {order.rejections.map((rejection) => (
                <li
                  key={rejection.reasonCode}
                  className="flex items-start justify-between gap-3 border-rule border-t pt-2 text-fine first:border-t-0 first:pt-0"
                >
                  <span className="text-ink">{rejection.reasonHuman}</span>
                  <span className="numeric shrink-0 text-muted">{rejection.count}</span>
                </li>
              ))}
            </ul>
          </Card>
        </Reveal>
      )}

      {canAccept && (
        <Reveal className="mt-6" from="up">
          <AcceptDeliveryCta orderId={order.id} />
        </Reveal>
      )}

      {canClose && (
        <Reveal className="mt-6" from="up">
          <CloseOrderForm orderId={order.id} />
        </Reveal>
      )}

      {(canCancel || canDispute) && (
        <Reveal className="mt-6" from="up">
          <BuyerIssueActions orderId={order.id} canCancel={canCancel} canDispute={canDispute} />
        </Reveal>
      )}

      {order.closedAt && (
        <Reveal className="mt-6" from="up">
          <Card padding="sm">
            <p className="text-sm font-bold text-ink">Заказ закрыт</p>
            <div className="mt-2 flex items-center justify-between text-fine">
              <span className="text-muted">Итоговая стоимость</span>
              <span className="numeric text-ink">{formatKzt(order.finalCostKzt ?? 0)}</span>
            </div>
            {order.settlement && order.settlement !== 'exact' && (
              <div className="mt-1 flex items-center justify-between text-fine">
                <span className="text-muted">
                  {order.settlement === 'refund' ? 'Возврат покупателю' : 'Доплата от покупателя'}
                </span>
                <span className="numeric text-ink">
                  {formatKzt(Math.abs(order.settlementAmountKzt ?? 0))}
                </span>
              </div>
            )}
          </Card>
        </Reveal>
      )}

      {(documents ?? []).length > 0 && (
        <Reveal className="mt-6" from="up">
          <Card padding="sm">
            <p className="text-sm font-bold text-ink">Документы заказа</p>
            <ul className="mt-3 flex flex-col gap-2">
              {(documents ?? []).map((document) => (
                <li
                  key={document.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-rule border-t pt-2 first:border-t-0 first:pt-0"
                >
                  <span className="text-fine text-ink">
                    {DOCUMENT_LABEL[document.type] ?? 'Документ'}
                  </span>
                  <span className="flex items-center gap-3">
                    <Link
                      href={document.url}
                      className="whitespace-nowrap text-fine font-semibold text-purple hover:underline"
                    >
                      Открыть
                    </Link>
                    <a
                      href={`/api/documents/${document.id}/download`}
                      className="whitespace-nowrap text-fine font-semibold text-muted hover:text-ink hover:underline"
                    >
                      Печать / PDF
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </Reveal>
      )}

      {order.state !== 'closed' && order.state !== 'cancelled' && (
        <Reveal className="mt-6" from="up">
          <Card padding="sm">
            <p className="text-sm font-bold text-ink">Подтверждение перевода</p>
            <p className="mt-1 text-fine text-muted">
              Загрузите банковское подтверждение к заказу. Сотрудник QAJET сверит его с фактом
              поступления и отдельно подтвердит оплату.
            </p>
            <AttachmentForm
              orderId={order.id}
              kind="prepay_proof"
              returnPath={`/buyer/orders/${order.id}`}
            />
          </Card>
        </Reveal>
      )}

      {(attachments ?? []).length > 0 && (
        <Reveal className="mt-6" from="up">
          <Card padding="sm">
            <p className="text-sm font-bold text-ink">Вложения заказа</p>
            <ul className="mt-3 flex flex-col gap-2">
              {(attachments ?? []).map((attachment) => (
                <li key={attachment.id} className="border-rule border-t pt-2 first:border-t-0">
                  <a
                    href={`/api/attachments/${attachment.id}/download`}
                    className="text-fine font-semibold text-purple hover:underline"
                  >
                    {attachment.file_name}
                  </a>
                  <span className="ml-2 text-micro text-muted">
                    {formatAttachmentSize(attachment.size_bytes)} · {attachment.kind}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </Reveal>
      )}

      {order.ratingTargets.some((target) => !target.rated) && (
        <Reveal className="mt-6" from="up">
          <Card padding="sm">
            <p className="text-sm font-bold text-ink">Оцените исполнение</p>
            <p className="mt-1 text-fine text-muted">
              Оценка доступна после закрытия заказа. QAJET показывает исполнителей без раскрытия их
              персональных данных.
            </p>
            <div className="mt-4 flex flex-col gap-4">
              {order.ratingTargets
                .filter((target) => !target.rated)
                .map((target, index) => (
                  <SupplierRatingForm
                    key={target.supplierCompanyId}
                    orderId={order.id}
                    supplierCompanyId={target.supplierCompanyId}
                    index={index}
                  />
                ))}
            </div>
          </Card>
        </Reveal>
      )}

      <Reveal className="mt-6" from="up">
        <h2 className="text-sm font-bold text-ink">История заказа</h2>
        <div className="mt-3 flex flex-col">
          {order.events.map((event) => (
            <div
              key={`${event.toState}-${event.at}`}
              className="flex items-center justify-between gap-4 border-t border-rule py-3 first:border-t-0"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{event.toStateLabel}</p>
                {event.actorName && (
                  <p className="mt-0.5 text-fine text-muted">{event.actorName}</p>
                )}
              </div>
              <span className="shrink-0 text-fine text-muted">
                {new Date(event.at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
              </span>
            </div>
          ))}
        </div>
      </Reveal>
    </div>
  );
}

function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}
