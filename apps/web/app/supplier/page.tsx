import { Reveal, Stagger, Stamp } from '@qajet/ui/motion';
import { Money, StatTile } from '@qajet/ui/primitives';
import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireCurrentUser } from '../lib/current-user';
import { ORDER_STATE_LABEL, ORDER_STATE_TONE, type OrderState } from '../lib/order-state';
import { loadSupplierHome } from '../lib/supplier-home';
import { RfqActions } from './_rfq-actions';

/**
 * Дашборд поставщика — §10 «Поставщик»: входящие RFQ с дедлайном ответа,
 * двухступенчатый ответ («берусь / не берусь» первым шагом), активные
 * заказы. Реальные данные из loadSupplierHome() (apps/web/app/lib/supplier-home.ts),
 * не мок. Мобильный сценарий первичен — оболочка уже даёт нижние табы,
 * здесь контент одной колонкой, читаемой с телефона.
 */

function formatRespondBy(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function formatEta(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export default async function SupplierHome() {
  const supabase = await createSupabaseServerClient();
  const user = await requireCurrentUser();
  const home = await loadSupplierHome(supabase, user.companyId);

  return (
    <div className="flex flex-col gap-6 px-4 py-5 sm:px-6 sm:py-6">
      <Reveal>
        <h1 className="text-2xl font-extrabold">
          Здравствуйте, {user.companyName ?? user.fullName}
        </h1>
        <p className="mt-1.5 text-fine text-muted">
          У вас {home.pendingRfqs.length} новых RFQ и {home.activeOrders.length} заказов в работе.
        </p>
      </Reveal>

      <Stagger startIndex={1} as="div" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile value={String(home.pendingRfqs.length)} title="Новых RFQ" note="Требуют ответа" />
        <StatTile
          value={String(home.activeOrders.length)}
          title="Заказов в работе"
          note="Не закрыто"
        />
        <StatTile
          value={<Money amountKzt={home.totalPayoutsKzt} className="text-xl font-semibold" />}
          title="Выплачено всего"
          note="По оплаченным заказам"
        />
        <StatTile
          value={home.avgBuyerScore !== null ? String(home.avgBuyerScore) : '—'}
          title="Оценка покупателей"
          note={home.avgBuyerScore !== null ? 'Средний балл' : 'Пока нет оценок'}
        />
      </Stagger>

      <Reveal delay={0.12} className="rounded-card border border-rule bg-surface">
        <div className="flex items-center justify-between border-rule border-b p-5">
          <h3 className="text-base font-bold">Новые RFQ — быстрый ответ</h3>
        </div>
        {home.pendingRfqs.length === 0 ? (
          <p className="p-5 text-fine text-muted">Сейчас нет новых запросов.</p>
        ) : (
          <ul>
            {home.pendingRfqs.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-3 border-rule border-b px-5 py-4 last:border-b-0 sm:flex-row sm:items-center"
              >
                <div className="h-10 w-10 shrink-0 rounded-control bg-page" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    {r.requestTitle}
                    {r.isExploration && (
                      <span className="text-micro font-normal text-muted">
                        · пробное приглашение
                      </span>
                    )}
                  </p>
                  <p className="text-fine text-muted">
                    {r.buyerCompany} · {r.itemsSummary}
                  </p>
                </div>
                <p className="text-fine font-semibold text-signal sm:whitespace-nowrap">
                  Ответить до {formatRespondBy(r.respondBy)}
                </p>
                <RfqActions rfqId={r.id} />
              </li>
            ))}
          </ul>
        )}
      </Reveal>

      <Reveal id="orders" delay={0.18} className="rounded-card border border-rule bg-surface p-5">
        <h3 className="mb-4 text-base font-bold">Заказы в производстве</h3>
        {home.activeOrders.length === 0 ? (
          <p className="text-fine text-muted">Пока нет активных заказов.</p>
        ) : (
          <ul className="flex flex-col gap-3.5">
            {home.activeOrders.map((o) => (
              <li key={o.id} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-fine font-semibold">
                    {o.title} — {o.buyerCompany}
                  </p>
                  <p className="text-micro text-muted">ETA {formatEta(o.etaDate)}</p>
                </div>
                <Stamp tone={ORDER_STATE_TONE[o.state as OrderState]} className="shrink-0">
                  {ORDER_STATE_LABEL[o.state as OrderState]}
                </Stamp>
                <Link
                  href={`/supplier/orders/${o.id}`}
                  className="text-fine font-semibold text-ink underline-offset-4 hover:underline"
                >
                  Открыть
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Reveal>
    </div>
  );
}
