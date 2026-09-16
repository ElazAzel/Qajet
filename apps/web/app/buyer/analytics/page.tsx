import { Reveal, Stagger } from '@qajet/ui/motion';
import { Money, StatTile } from '@qajet/ui/primitives';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { loadBuyerAnalytics } from '../../lib/buyer-analytics';

/**
 * Аналитика закупок, в том числе по сотрудникам — agents.md §10
 * «Покупатель». См. `buyer-analytics.ts`.
 */
export default async function BuyerAnalyticsPage() {
  const supabase = await createSupabaseServerClient();
  const data = await loadBuyerAnalytics(supabase);

  return (
    <div className="flex flex-col gap-6 px-4 py-5 sm:px-6 sm:py-6">
      <Reveal>
        <h1 className="text-2xl font-extrabold text-ink">Аналитика закупок</h1>
        <p className="mt-1.5 text-fine text-muted">По закрытым заказам компании.</p>
      </Reveal>

      <Stagger startIndex={1} as="div" className="grid grid-cols-2 gap-3">
        <StatTile
          value={<Money amountKzt={data.totalKzt} className="text-xl font-semibold" />}
          title="Всего потрачено"
        />
        <StatTile value={String(data.ordersCount)} title="Закрытых заказов" />
      </Stagger>

      <Reveal delay={0.12} className="rounded-card border border-rule bg-surface">
        <div className="border-rule border-b p-5">
          <h2 className="text-base font-bold text-ink">По сотрудникам</h2>
        </div>
        {data.byEmployee.length === 0 ? (
          <p className="p-5 text-fine text-muted">Пока нет закрытых заказов.</p>
        ) : (
          <ul>
            {data.byEmployee.map((e) => (
              <li
                key={e.userId}
                className="flex items-center justify-between gap-3 border-rule border-b px-5 py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-fine font-semibold text-ink">{e.fullName}</p>
                  <p className="text-micro text-muted">{e.ordersCount} заказов</p>
                </div>
                <Money amountKzt={e.totalKzt} className="shrink-0 font-semibold" />
              </li>
            ))}
          </ul>
        )}
      </Reveal>

      <Reveal delay={0.18} className="rounded-card border border-rule bg-surface">
        <div className="border-rule border-b p-5">
          <h2 className="text-base font-bold text-ink">По категориям</h2>
        </div>
        {data.byCategory.length === 0 ? (
          <p className="p-5 text-fine text-muted">Пока нет закрытых заказов.</p>
        ) : (
          <ul>
            {data.byCategory.map((c) => (
              <li
                key={c.category}
                className="flex items-center justify-between gap-3 border-rule border-b px-5 py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-fine font-semibold text-ink">{c.label}</p>
                  <p className="text-micro text-muted">{c.ordersCount} заказов</p>
                </div>
                <Money amountKzt={c.totalKzt} className="shrink-0 font-semibold" />
              </li>
            ))}
          </ul>
        )}
      </Reveal>
    </div>
  );
}
