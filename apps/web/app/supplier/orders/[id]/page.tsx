import { Reveal, Stamp } from '@qajet/ui/motion';
import { Card, Money } from '@qajet/ui/primitives';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { AttachmentForm } from '../../../buyer/messages/_attachment-form';
import { requireActor } from '../../../lib/current-user';
import { ORDER_STATE_LABEL, ORDER_STATE_TONE, type OrderState } from '../../../lib/order-state';
import { DeliveryConfirmButton } from './_delivery-confirm';

export default async function SupplierOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireActor('supplier');
  const supabase = await createSupabaseServerClient();
  const { data: order } = await supabase
    .from('orders')
    .select('id, state, approved_plan_id, requests(title, companies(name)), plans(eta_date)')
    .eq('id', id)
    .maybeSingle();

  if (!order) notFound();

  const request = Array.isArray(order.requests) ? order.requests[0] : order.requests;
  const company = request
    ? Array.isArray(request.companies)
      ? request.companies[0]
      : request.companies
    : null;
  const plan = Array.isArray(order.plans) ? order.plans[0] : order.plans;
  const state = order.state as OrderState;
  const { data: ownLines } = await supabase
    .from('plan_lines')
    .select('line_total_kzt')
    .eq('plan_id', order.approved_plan_id)
    .eq('supplier_company_id', user.companyId ?? '');
  const ownPayableKzt = (ownLines ?? []).reduce((sum, line) => sum + line.line_total_kzt, 0);
  const { data: attachments } = await supabase
    .from('attachments')
    .select('id, file_name, size_bytes, kind')
    .eq('order_id', order.id)
    .order('created_at', { ascending: false });

  return (
    <div className="mx-auto max-w-2xl px-4 py-5 sm:px-6 sm:py-6">
      <Link href="/supplier" className="text-fine font-semibold text-muted hover:text-ink">
        ← К заказам
      </Link>
      <Reveal className="mt-4">
        <Stamp tone={ORDER_STATE_TONE[state]} className="w-fit">
          {ORDER_STATE_LABEL[state]}
        </Stamp>
        <h1 className="mt-2 text-2xl font-extrabold text-ink">{request?.title ?? 'Заказ'}</h1>
        <p className="mt-1 text-sm text-muted">Покупатель: {company?.name ?? '—'}</p>
      </Reveal>

      <Reveal className="mt-6" from="up">
        <Card padding="sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-fine text-muted">Ваше обязательство по плану</p>
              <p className="mt-1 text-xl font-extrabold text-ink">
                <Money amountKzt={ownPayableKzt} />
              </p>
            </div>
            <p className="text-right text-fine text-muted">ETA {plan?.eta_date ?? '—'}</p>
          </div>

          {state === 'shipped' && (
            <div className="mt-5 border-rule border-t pt-5">
              <p className="mb-3 text-fine text-muted">
                Подтвердите факт доставки. При нескольких поставщиках заказ перейдёт дальше после
                подтверждения каждого из них.
              </p>
              <DeliveryConfirmButton orderId={order.id} />
            </div>
          )}
          {state === 'delivered' && (
            <p className="mt-5 border-rule border-t pt-5 text-fine font-semibold text-signal">
              Доставка подтверждена. Ожидается приёмка покупателем.
            </p>
          )}
          {state !== 'closed' && state !== 'cancelled' && (
            <div className="mt-5 border-rule border-t pt-5">
              <p className="mb-2 text-fine text-muted">
                Прикрепите подтверждение доставки или рабочий документ к заказу.
              </p>
              <AttachmentForm
                orderId={order.id}
                kind="delivery_proof"
                returnPath={`/supplier/orders/${order.id}`}
              />
            </div>
          )}
          {(attachments ?? []).length > 0 && (
            <div className="mt-5 border-rule border-t pt-5">
              <p className="text-micro font-semibold text-muted uppercase">Вложения заказа</p>
              <ul className="mt-2 flex flex-col gap-1">
                {(attachments ?? []).map((attachment) => (
                  <li key={attachment.id}>
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
            </div>
          )}
          <p className="mt-4 text-micro text-muted">
            Покупатель видит итог QAJET; закупочные цены и комиссию других участников вы не видите.
          </p>
          <Link
            href={`/supplier/orders/${order.id}/messages`}
            className="mt-3 inline-block text-fine font-semibold text-purple hover:underline"
          >
            Открыть переписку по заказу →
          </Link>
        </Card>
      </Reveal>
    </div>
  );
}

function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}
