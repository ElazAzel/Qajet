import { Reveal, Stamp } from '@qajet/ui/motion';
import { Card, Money } from '@qajet/ui/primitives';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireActor } from '../../../lib/current-user';
import { ORDER_STATE_LABEL, ORDER_STATE_TONE, type OrderState } from '../../../lib/order-state';
import { DeliveryConfirmButton } from './_delivery-confirm';

export default async function SupplierOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireActor('supplier');
  const supabase = await createSupabaseServerClient();
  const { data: order } = await supabase
    .from('orders')
    .select('id, state, requests(title, companies(name)), plans(total_kzt, eta_date)')
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
              <p className="text-fine text-muted">Согласованный план</p>
              <p className="mt-1 text-xl font-extrabold text-ink">
                <Money amountKzt={plan?.total_kzt ?? 0} />
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
        </Card>
      </Reveal>
    </div>
  );
}
