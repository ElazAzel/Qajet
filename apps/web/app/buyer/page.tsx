import { Reveal, Stagger, Stamp } from '@qajet/ui/motion';
import { Clock3, FilePlus, ListChecks, Package, Search, Wrench } from 'lucide-react';
import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { loadBuyerHome } from '../lib/buyer-home';
import { ORDER_STATE_LABEL, ORDER_STATE_TONE } from '../lib/order-state';
import { BuyerHero } from './_hero';

const EVENT_LABEL: Record<string, string> = {
  draft: 'Заявка создана',
  estimated: 'Оценка готова',
  prepaid: 'Предоплата внесена',
  rfq_sent: 'Запрос отправлен поставщикам',
  quotes_received: 'Получены предложения',
  plan_proposed: 'Предложен план',
  plan_approved: 'План утверждён',
  suppliers_paid: 'Поставщики оплачены',
  in_production: 'Запущено производство',
  shipped: 'Заказ отгружен',
  delivered: 'Заказ доставлен',
  accepted: 'Заказ принят',
  closed: 'Заказ закрыт',
  awaiting_internal_approval: 'Ждёт вашего согласования',
  on_hold: 'Поставлен на паузу',
  cancelled: 'Заказ отменён',
  disputed: 'Открыт спор',
};

export default async function BuyerHome() {
  const supabase = await createSupabaseServerClient();
  const { orders, updates, stats } = await loadBuyerHome(supabase);

  return (
    <div className="flex flex-col gap-6">
      <Reveal from="up">
        <BuyerHero />
      </Reveal>

      <Stagger startIndex={1} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile icon={<Package size={18} />} value={stats.active} title="Активных заказов" />
        <StatTile
          icon={<Wrench size={18} />}
          value={stats.inProduction}
          title="В производстве/отгрузке"
        />
        <StatTile
          icon={<Clock3 size={18} />}
          value={stats.awaitingDecision}
          title="Ждут вашего решения"
        />
      </Stagger>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.15fr_1fr]">
        <Reveal className="rounded-card border border-rule bg-surface p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-ink">Обновления по заказам</h3>
          </div>
          <div className="mt-3 flex flex-col">
            {updates.length === 0 && <p className="py-6 text-sm text-muted">Пока нет событий.</p>}
            {updates.map((update) => (
              <div
                key={`${update.orderId}-${update.at}`}
                className="flex items-center justify-between gap-4 border-t border-rule py-3 first:border-t-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">
                    {EVENT_LABEL[update.toState] ?? ORDER_STATE_LABEL[update.toState]}
                  </p>
                  <p className="mt-0.5 truncate text-fine text-muted">{update.orderTitle}</p>
                </div>
                <span className="shrink-0 text-fine text-muted">
                  {new Date(update.at).toLocaleDateString('ru-RU', {
                    day: 'numeric',
                    month: 'short',
                  })}
                </span>
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal className="rounded-card border border-rule bg-surface p-6" from="up">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-ink">Мои заказы</h3>
            <Link href="/buyer" className="text-fine font-semibold text-purple">
              Все заказы →
            </Link>
          </div>
          <div className="mt-3 flex flex-col gap-3">
            {orders.slice(0, 6).map((order) => (
              <Link
                key={order.id}
                href={`/buyer/orders/${order.id}`}
                className="flex items-center gap-3 rounded-control -mx-2 px-2 py-1 hover:bg-page"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{order.title}</p>
                </div>
                <Stamp tone={ORDER_STATE_TONE[order.state]} className="shrink-0">
                  {ORDER_STATE_LABEL[order.state]}
                </Stamp>
              </Link>
            ))}
          </div>
        </Reveal>
      </div>

      <Reveal className="flex flex-col gap-4 rounded-card border border-rule bg-surface p-6 sm:flex-row sm:items-center">
        <h3 className="shrink-0 text-lg font-bold text-ink">Быстрые действия</h3>
        <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-3">
          <QuickAction
            href="/buyer/requests/new"
            icon={<FilePlus size={16} />}
            title="Создать заявку"
            sub="Запустить новую закупку"
          />
          <QuickAction
            href="/buyer/suppliers"
            icon={<Search size={16} />}
            title="Найти поставщика"
            sub="Проверенные партнёры"
          />
          <QuickAction
            href="/buyer"
            icon={<ListChecks size={16} />}
            title="Все заказы"
            sub="Перейти к списку"
          />
        </div>
      </Reveal>
    </div>
  );
}

function StatTile({ icon, value, title }: { icon: React.ReactNode; value: number; title: string }) {
  return (
    <div className="flex items-center gap-4 rounded-card border border-rule bg-surface p-5">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-purple-10 text-purple">
        {icon}
      </span>
      <div>
        <p className="text-2xl font-extrabold text-ink">{value}</p>
        <p className="text-fine font-medium text-muted">{title}</p>
      </div>
    </div>
  );
}

function QuickAction({
  href,
  icon,
  title,
  sub,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  sub: string;
}) {
  return (
    <Link href={href} className="flex items-center gap-3 hover:opacity-80">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-purple-10 text-purple">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-bold text-ink">{title}</p>
        <p className="truncate text-fine text-muted">{sub}</p>
      </div>
    </Link>
  );
}
