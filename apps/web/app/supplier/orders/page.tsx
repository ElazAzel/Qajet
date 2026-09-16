import { Reveal, Stamp } from '@qajet/ui/motion';
import { Money } from '@qajet/ui/primitives';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ORDER_STATE_LABEL, ORDER_STATE_TONE } from '../../lib/order-state';
import { loadSupplierOrders, SUPPLIER_CONFIRM_LABEL } from '../../lib/supplier-orders';
import { ConfirmStage } from './_confirm-stage';

/**
 * Заказы поставщика — agents.md §10. Отличие от дашборда `/supplier`: там
 * активные заказы показаны списком без действий, здесь — вся история
 * (включая закрытые) и подтверждение стадий, которые поставщик закрывает
 * сам.
 *
 * Сумма — своя выплата, а не сумма плана: чужие строки плана поставщику не
 * видны (ADR-0009), и показывать ему общий бюджет заказа значило бы
 * раскрыть маржу и цены соседей по плану.
 */
export default async function SupplierOrdersPage() {
  const supabase = await createSupabaseServerClient();
  const orders = await loadSupplierOrders(supabase);

  const active = orders.filter((o) => o.state !== 'closed' && o.state !== 'cancelled');
  const archived = orders.filter((o) => o.state === 'closed' || o.state === 'cancelled');

  return (
    <div className="flex flex-col gap-6 px-4 py-5 sm:px-6 sm:py-6">
      <Reveal>
        <h1 className="text-2xl font-extrabold">Заказы</h1>
        <p className="mt-1.5 text-fine text-muted">
          {active.length} в работе, {archived.length} завершено. Производство и отгрузку
          подтверждаете вы — остальные стадии ведёт консьерж.
        </p>
      </Reveal>

      <Reveal delay={0.08} className="rounded-card border border-rule bg-surface">
        <div className="border-rule border-b p-5">
          <h2 className="text-base font-bold">В работе</h2>
        </div>
        {active.length === 0 ? (
          <p className="p-5 text-fine text-muted">
            Сейчас нет заказов в работе — они появятся после того, как покупатель утвердит план с
            вашим предложением.
          </p>
        ) : (
          <ul>
            {active.map((order) => (
              <li
                key={order.id}
                className="flex flex-col gap-3 border-rule border-b px-5 py-4 last:border-b-0 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{order.title}</p>
                  <p className="truncate text-fine text-muted">
                    {order.buyerCompany}
                    {order.etaDate && ` · ETA ${formatDate(order.etaDate)}`}
                  </p>
                </div>
                {order.payoutKzt !== null && (
                  <div className="shrink-0 text-fine">
                    <Money amountKzt={order.payoutKzt} className="font-semibold" />
                    <span className="ml-1.5 text-muted">
                      {order.payoutStatus === 'paid' ? 'выплачено' : 'к выплате'}
                    </span>
                  </div>
                )}
                <Stamp tone={ORDER_STATE_TONE[order.state]} className="shrink-0">
                  {ORDER_STATE_LABEL[order.state]}
                </Stamp>
                {order.confirmable.length > 0 && (
                  <ConfirmStage
                    orderId={order.id}
                    options={order.confirmable.map((state) => ({
                      state,
                      label: SUPPLIER_CONFIRM_LABEL[state] ?? ORDER_STATE_LABEL[state],
                    }))}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Reveal>

      {archived.length > 0 && (
        <Reveal delay={0.14} className="rounded-card border border-rule bg-surface">
          <div className="border-rule border-b p-5">
            <h2 className="text-base font-bold">Завершённые</h2>
          </div>
          <ul>
            {archived.map((order) => (
              <li
                key={order.id}
                className="flex items-center gap-3 border-rule border-b px-5 py-3 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-fine font-semibold text-ink">{order.title}</p>
                  <p className="truncate text-micro text-muted">{order.buyerCompany}</p>
                </div>
                {order.payoutKzt !== null && (
                  <Money amountKzt={order.payoutKzt} className="shrink-0 text-fine text-muted" />
                )}
                <Stamp tone={ORDER_STATE_TONE[order.state]} className="shrink-0">
                  {ORDER_STATE_LABEL[order.state]}
                </Stamp>
              </li>
            ))}
          </ul>
        </Reveal>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
