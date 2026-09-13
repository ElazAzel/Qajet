import { Reveal, Stagger, Stamp } from '@qajet/ui/motion';
import { Card, StatTile } from '@qajet/ui/primitives';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { loadCommissionSuggestions } from '../../lib/actions/plan-actions';
import { CATEGORY_LABEL, type CatalogCategory } from '../../lib/catalog';
import { loadAliasMetrics, loadLearningMetrics } from '../../lib/learning-metrics';
import { ExplorationChart, LeadtimeChart, MapeMarginChart } from './_charts';

/**
 * «Как система учится» — agents.md §8G, §10: обязан быть реальным экраном
 * на реальных данных сида, не картинкой. Источник — model_snapshots
 * (пишутся при recalibrate()) и rfqs.is_exploration.
 */
export default async function AdminLearningPage() {
  const supabase = await createSupabaseServerClient();
  const [
    { estimator, leadtime, exploration, explorationSuppliersTotal },
    { correctionsTotal, aliases },
    commissionSuggestions,
    { data: queueRows, error: queueError },
  ] = await Promise.all([
    loadLearningMetrics(supabase),
    loadAliasMetrics(supabase),
    loadCommissionSuggestions(supabase),
    supabase
      .from('learning_events')
      .select('id, type, processed_at, attempts, leased_until, last_error, created_at')
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  const latestEstimator = estimator.at(-1);
  const firstEstimator = estimator[0];
  const latestLeadtime = leadtime.at(-1);
  const explorationTotal = exploration.reduce((sum, p) => sum + p.count, 0);

  return (
    <div className="flex flex-col gap-6">
      <Reveal>
        <h1 className="text-2xl font-extrabold text-ink">Как система учится</h1>
        <p className="mt-1.5 text-sm text-muted">
          {estimator.length} прогонов recalibrate() за {estimator.length} мес. — из model_snapshots,
          не нарисовано.
        </p>
      </Reveal>

      <Stagger startIndex={1} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          title="Точность калькулятора сейчас"
          value={
            latestEstimator?.avgMapePct !== null && latestEstimator?.avgMapePct !== undefined
              ? `${latestEstimator.avgMapePct.toFixed(1)}% MAPE`
              : 'нет данных'
          }
          note={
            firstEstimator?.avgMapePct !== null &&
            firstEstimator?.avgMapePct !== undefined &&
            latestEstimator?.avgMapePct !== null &&
            latestEstimator?.avgMapePct !== undefined
              ? `было ${firstEstimator.avgMapePct.toFixed(1)}% в первый месяц`
              : `${latestEstimator?.categoriesWithHistory ?? 0} из ${latestEstimator?.categoriesTotal ?? 0} категорий с историей`
          }
        />
        <StatTile
          title="Средний запас"
          value={latestEstimator ? `${latestEstimator.avgMarginPct.toFixed(1)}%` : 'нет данных'}
          note={
            firstEstimator
              ? `было ${firstEstimator.avgMarginPct.toFixed(1)}% — запас снижается по мере накопления истории`
              : ''
          }
        />
        <StatTile
          title="Поставщиков с историей срока"
          value={latestLeadtime ? String(latestLeadtime.nSuppliersWithHistory) : 'нет данных'}
          note={`${explorationTotal} назначений через слоты исследования, ${explorationSuppliersTotal} новых поставщиков`}
        />
        <StatTile
          title="Исправлений категории"
          value={String(correctionsTotal)}
          note={`${aliases.filter((a) => a.autoApplied).length} алиасов применяются автоматически`}
        />
      </Stagger>

      <Reveal delay={0.12}>
        <Card>
          <h3 className="text-base font-bold text-ink">MAPE калькулятора и средний запас</h3>
          <p className="mt-1 text-fine text-muted">
            MAPE — средняя ошибка оценки по категориям, где уже есть история наблюдений. Запас —
            P80-квантиль ошибки, который движок закладывает сверх точечной оценки; он снижается по
            мере роста числа наблюдений на товар.
          </p>
          {estimator.length > 0 ? (
            <div className="mt-4">
              <MapeMarginChart points={estimator} />
            </div>
          ) : (
            <EmptyNote text="Нет ни одного прогона estimator в model_snapshots." />
          )}
        </Card>
      </Reveal>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Reveal delay={0.18}>
          <Card>
            <h3 className="text-base font-bold text-ink">Поставщики с историей срока поставки</h3>
            <p className="mt-1 text-fine text-muted">
              leadtime.predictAfterQuote() сдвигает прогноз к 1.0 при малой выборке — чем больше
              поставщиков с накопленной историей, тем точнее slack_days в сравнении вариантов.
            </p>
            {leadtime.length > 0 ? (
              <div className="mt-4">
                <LeadtimeChart points={leadtime} />
              </div>
            ) : (
              <EmptyNote text="Нет ни одного прогона leadtime в model_snapshots." />
            )}
          </Card>
        </Reveal>

        <Reveal delay={0.22}>
          <Card>
            <h3 className="text-base font-bold text-ink">
              Новые поставщики через слоты исследования
            </h3>
            <p className="mt-1 text-fine text-muted">
              Thompson sampling иногда осознанно приглашает поставщика без истории вместо
              проверенного лидера — так матчер собирает данные о новых компаниях, а не застревает на
              первых лидерах навсегда.
            </p>
            {exploration.length > 0 ? (
              <div className="mt-4">
                <ExplorationChart points={exploration} />
              </div>
            ) : (
              <EmptyNote text="Ни одного RFQ со слотом исследования (rfqs.is_exploration) пока нет." />
            )}
          </Card>
        </Reveal>
      </div>

      <Reveal delay={0.28}>
        <Card>
          <h3 className="text-base font-bold text-ink">Алиасы номенклатуры</h3>
          <p className="mt-1 text-fine text-muted">
            Каждое исправление категории консьержем (agents.md §8A) пишет или усиливает алиас — hits
            ≥ 3 считается устойчивым сигналом и помечен как применяемый автоматически.
          </p>
          {aliases.length > 0 ? (
            <ul className="mt-4 flex flex-col gap-2">
              {aliases.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 border-rule border-b pb-2 text-fine last:border-b-0"
                >
                  <span className="min-w-0 truncate">
                    «{a.alias}» → <span className="font-semibold text-ink">{a.canonical}</span>
                    <span className="text-muted"> ({a.kind})</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-muted">hits: {a.hits}</span>
                    {a.autoApplied && <Stamp tone="progress">применяется автоматически</Stamp>}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyNote text="Пока нет ни одного алиаса — появится после первого исправления категории консьержем." />
          )}
        </Card>
      </Reveal>

      <Reveal delay={0.32}>
        <Card>
          <h3 className="text-base font-bold text-ink">Комиссия по категориям</h3>
          <p className="mt-1 text-fine text-muted">
            По умолчанию 23% на позицию (agents.md §7) — консьерж правит точечно, 21-24%. Здесь —
            усреднение прошлых правок по категории (learning_events), подсказка появляется после 3
            похожих решений, применяется только вручную.
          </p>
          {commissionSuggestions.size > 0 ? (
            <ul className="mt-4 flex flex-col gap-2">
              {[...commissionSuggestions.entries()].map(([category, suggestion]) => (
                <li
                  key={category}
                  className="flex items-center justify-between gap-3 border-rule border-b pb-2 text-fine last:border-b-0"
                >
                  <span className="font-semibold text-ink">
                    {CATEGORY_LABEL[category as CatalogCategory] ?? category}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-muted">{suggestion.sampleCount} решений</span>
                    <Stamp tone="progress">советует {suggestion.pct}%</Stamp>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyNote text="Пока нет подсказки ни по одной категории — появится после 3 правок комиссии консьержем в одной категории." />
          )}
        </Card>
      </Reveal>

      <Reveal delay={0.36}>
        <Card>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-ink">Очередь обучающих событий</h3>
              <p className="mt-1 text-fine text-muted">
                События закрытых заказов обрабатываются отдельно от пользовательского запроса; сбой
                остаётся видимым и может быть повторен worker-ом.
              </p>
            </div>
            <Stamp tone="neutral">последние 50</Stamp>
          </div>
          {queueError ? (
            <p className="mt-4 text-fine text-danger">Очередь недоступна: {queueError.message}</p>
          ) : queueRows?.length ? (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-fine">
                <thead>
                  <tr className="border-rule border-b text-micro text-muted uppercase tracking-wide">
                    <th className="px-2 py-2.5 text-left font-semibold">Создано</th>
                    <th className="px-2 py-2.5 text-left font-semibold">Тип</th>
                    <th className="px-2 py-2.5 text-left font-semibold">Состояние</th>
                    <th className="px-2 py-2.5 text-left font-semibold">Попытки / ошибка</th>
                  </tr>
                </thead>
                <tbody>
                  {queueRows.map((row) => {
                    const failed = Boolean(row.last_error);
                    const done = Boolean(row.processed_at);
                    return (
                      <tr key={row.id} className="border-rule border-b align-top last:border-b-0">
                        <td className="whitespace-nowrap px-2 py-3 text-muted">
                          {formatDateTime(row.created_at)}
                        </td>
                        <td className="px-2 py-3 font-semibold">{row.type}</td>
                        <td className="px-2 py-3">
                          <Stamp tone={failed ? 'signal' : done ? 'success' : 'pending'}>
                            {failed ? 'Ошибка' : done ? 'Обработано' : 'В очереди'}
                          </Stamp>
                          {row.leased_until && !done && (
                            <p className="mt-1 text-micro text-muted">
                              lease до {formatDateTime(row.leased_until)}
                            </p>
                          )}
                        </td>
                        <td className="max-w-80 px-2 py-3 text-muted">
                          {row.attempts}
                          {row.last_error && <p className="mt-1 text-danger">{row.last_error}</p>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-4 text-fine text-muted">Обучающих событий пока нет.</p>
          )}
        </Card>
      </Reveal>
    </div>
  );
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('ru-RU', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
}

function EmptyNote({ text }: { text: string }) {
  return <p className="mt-4 text-fine text-muted">{text}</p>;
}
