import { Reveal, Stagger } from '@qajet/ui/motion';
import { formatKzt, StatTile } from '@qajet/ui/primitives';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireActor } from '../lib/current-user';
import { loadMetrics } from '../lib/metrics';
import { createJuryMetricsClient, isValidJuryToken } from './_jury-access';
import { JuryLinkButton } from './_jury-link-button';

/**
 * /metrics — agents.md §9: «доступен админу и по временной ссылке для
 * жюри». `?jury=<токен>` — подписанный токен без входа
 * (`../lib/signed-link.ts`), проверяется здесь до `requireCurrentUser()`,
 * поэтому по валидной ссылке экран открывается вообще без сессии.
 * Реальные данные жюри показываются через `service_role`-клиент
 * (`_jury-access.ts`) — обоснование там же, в комментарии.
 *
 * Отдельная от AdminShell страница: экран рассчитан на демонстрацию
 * «на сцене», не на повседневную навигацию внутри админки.
 */
export default async function MetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ jury?: string }>;
}) {
  const { jury } = await searchParams;
  const isJuryAccess = isValidJuryToken(jury);

  const supabase = isJuryAccess ? createJuryMetricsClient() : await requireAdminSession();
  const metrics = await loadMetrics(supabase);

  const conversionPct =
    metrics.rfqConversion.requestsWithRfq > 0
      ? Math.round(
          (metrics.rfqConversion.requestsWithRfqAndOrder / metrics.rfqConversion.requestsWithRfq) *
            100,
        )
      : null;

  const repeatPct =
    metrics.repeatCompanies.total > 0
      ? Math.round((metrics.repeatCompanies.repeat / metrics.repeatCompanies.total) * 100)
      : null;

  return (
    <div className="min-h-screen bg-page px-6 py-10 sm:px-10">
      <div className="mx-auto max-w-5xl">
        <Reveal>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-micro tracking-wide text-muted uppercase">QAJET · /metrics</p>
              <h1 className="mt-1 text-3xl font-extrabold text-ink">Юнит-экономика</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted">
                Комиссия {metrics.commissionRatePct}% — параметр в settings, меняется вживую при
                вопросе жюри. Все числа ниже — реальные данные демо-сида, не иллюстрация.
              </p>
            </div>
            {/* Кнопка выпуска ссылки — только под сессией админа, не по самой ссылке жюри
                (у неё нет своей сессии, чтобы выпускать новые ссылки). */}
            {!isJuryAccess && <JuryLinkButton />}
          </div>
        </Reveal>

        <Stagger
          startIndex={1}
          className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <StatTile
            title="Конверсия RFQ → сделка"
            value={conversionPct !== null ? `${conversionPct}%` : 'нет данных'}
            note={`${metrics.rfqConversion.requestsWithRfqAndOrder} из ${metrics.rfqConversion.requestsWithRfq} заявок с отправленным RFQ дошли до заказа`}
            className="p-6"
          />
          <StatTile
            title="Точность калькулятора"
            value={
              metrics.estimatorMapePct !== null
                ? `${metrics.estimatorMapePct.toFixed(1)}% MAPE`
                : 'нет данных'
            }
            note="Средняя ошибка оценки по категориям с историей наблюдений, последний прогон recalibrate()"
            className="p-6"
          />
          <StatTile
            title="Компании с повторным заказом"
            value={repeatPct !== null ? `${repeatPct}%` : 'нет данных'}
            note={`${metrics.repeatCompanies.repeat} из ${metrics.repeatCompanies.total} компаний — главная метрика пилота`}
            tone="highlight"
            className="p-6"
          />
          <StatTile
            title="GMV закрытых заказов"
            value={formatKzt(metrics.gmv.totalKzt)}
            note={`${metrics.gmv.closedOrders} закрытых заказов · метрика масштаба, не прибыльности`}
            className="p-6"
          />
          <StatTile
            title="Комиссия QAJET заработана"
            value={formatKzt(metrics.commission.totalKzt)}
            note={`${metrics.commission.closedOrders} заказов · в среднем ${formatKzt(metrics.commission.avgKzt)} на заказ`}
            className="p-6"
          />
          <StatTile
            title="Активные часы на заказ"
            value={metrics.hasTimeEntries ? '—' : 'нет данных'}
            note="Автотаймер консьержа (agents.md §9) ещё не подключён к экрану заказа — time_entries пока не пишется"
            tone="muted"
            className="p-6"
          />
        </Stagger>
      </div>
    </div>
  );
}

async function requireAdminSession() {
  await requireActor('admin');
  return createSupabaseServerClient();
}
