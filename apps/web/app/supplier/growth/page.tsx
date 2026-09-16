import { Reveal, Stagger } from '@qajet/ui/motion';
import { StatTile } from '@qajet/ui/primitives';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireCurrentUser } from '../../lib/current-user';
import { loadSupplierGrowth } from '../../lib/supplier-growth';

/**
 * Дашборд роста поставщика — agents.md §10. См. `supplier-growth.ts` для
 * объяснения, почему каждая метрика показана вместе с тем, что она меняет
 * в подборе.
 */
export default async function SupplierGrowthPage() {
  const supabase = await createSupabaseServerClient();
  const user = await requireCurrentUser();
  const growth = await loadSupplierGrowth(supabase, user.companyId);

  if (!growth) {
    return (
      <div className="px-4 py-5 sm:px-6 sm:py-6">
        <p className="text-fine text-muted">Статистика появится после первого заказа.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 px-4 py-5 sm:px-6 sm:py-6">
      <Reveal>
        <h1 className="text-2xl font-extrabold">Рост</h1>
        <p className="mt-1.5 text-fine text-muted">
          Эти же числа использует подбор поставщиков — здесь видно, что именно на них влияет.
        </p>
      </Reveal>

      <Stagger startIndex={1} as="div" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {growth.metrics.map((m) => (
          <StatTile key={m.key} value={m.value} title={m.label} note={m.effect} />
        ))}
      </Stagger>

      <Reveal delay={0.2} className="rounded-card border border-rule bg-surface">
        <div className="border-rule border-b p-5">
          <h2 className="text-base font-bold">Последние оценки покупателей</h2>
        </div>
        {growth.ratings.length === 0 ? (
          <p className="p-5 text-fine text-muted">Пока нет оценок.</p>
        ) : (
          <ul>
            {growth.ratings.map((r, i) => (
              <li
                key={i}
                className="flex flex-col gap-1.5 border-rule border-b px-5 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{r.orderTitle}</p>
                  {r.comment && <p className="truncate text-fine text-muted">{r.comment}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2 text-fine">
                  <span className="font-semibold text-ink">{r.score} / 5</span>
                  {!r.wasOnTime && <span className="text-danger">не в срок</span>}
                  {r.hadDispute && <span className="text-danger">спор</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Reveal>
    </div>
  );
}
