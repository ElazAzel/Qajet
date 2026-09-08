import { Reveal, Stagger } from '@qajet/ui/motion';
import { Card, StatTile } from '@qajet/ui/primitives';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { loadLearningMetrics } from '../../lib/learning-metrics';
import { ExplorationChart, LeadtimeChart, MapeMarginChart } from './_charts';

/**
 * «Как система учится» — agents.md §8G, §10: обязан быть реальным экраном
 * на реальных данных сида, не картинкой. Источник — model_snapshots
 * (пишутся при recalibrate()) и rfqs.is_exploration.
 */
export default async function AdminLearningPage() {
  const supabase = await createSupabaseServerClient();
  const { estimator, leadtime, exploration, explorationSuppliersTotal } =
    await loadLearningMetrics(supabase);

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

      <Stagger startIndex={1} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return <p className="mt-4 text-fine text-muted">{text}</p>;
}
