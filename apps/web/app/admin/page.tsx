import { Reveal, Stagger, Stamp, type StampTone } from '@qajet/ui/motion';
import { Card, Money, StatTile } from '@qajet/ui/primitives';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { loadAdminHome, type VerificationRow } from '../lib/admin-home';
import { CATEGORY_LABEL, type CatalogCategory } from '../lib/catalog';
import { SupplierVerificationActions } from './companies/_company-actions';

/**
 * Обзор платформы / верификация поставщиков — §10 «Админ». Первый пункт
 * раздела: «Верификация и комплаенс поставщиков» — companies.verified_at,
 * verification_note (agents.md §5). Настройка комиссии, финансовая сверка
 * и «Как система учится» — отдельные разделы того же меню (см. layout).
 *
 * Раньше вся страница была хардкодом (STATS/VENDORS/USERS/PAYOUTS прямо
 * тут) — найдено при UI-аудите: реальный логин показывал реального
 * админа в шапке и вымышленные цифры/компании под ней. Данные теперь из
 * lib/admin-home.ts, тот же принцип, что у /metrics (lib/metrics.ts).
 */

const STATUS_LABEL: Record<VerificationRow['status'], string> = {
  pending: 'На проверке',
  approved: 'Одобрен',
  rejected: 'Отклонён',
};
const STATUS_TONE: Record<VerificationRow['status'], StampTone> = {
  pending: 'neutral',
  approved: 'progress',
  rejected: 'signal',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export default async function AdminHome() {
  const supabase = await createSupabaseServerClient();
  const data = await loadAdminHome(supabase);

  return (
    <div className="flex flex-col gap-6">
      <Reveal>
        <h1 className="text-2xl font-extrabold">Верификация поставщиков</h1>
        <p className="mt-1.5 text-fine text-muted">
          Комплаенс и статус проверки — компании появляются в очереди сразу после регистрации.
        </p>
      </Reveal>

      <Stagger startIndex={1} as="div" className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile
          value={String(data.usersTotal)}
          title="Пользователей"
          note={`+${data.usersNewLast30d} за месяц`}
        />
        <StatTile
          value={String(data.suppliersTotal)}
          title="Поставщиков"
          note={`+${data.suppliersNewLast30d} за месяц`}
        />
        <StatTile
          value={
            <Money amountKzt={data.turnoverThisMonthKzt} className="text-2xl font-extrabold" />
          }
          title="Оборот за месяц"
          note={
            data.turnoverMomPct === null
              ? 'нет данных за прошлый месяц'
              : `${data.turnoverMomPct >= 0 ? '+' : ''}${data.turnoverMomPct}% к прошлому`
          }
        />
        <StatTile
          value={String(data.pendingVerificationCount)}
          title="На верификации"
          note="Требуют проверки"
        />
      </Stagger>

      <Reveal delay={0.12}>
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-bold">Очередь на верификацию</h3>
          </div>
          {data.verificationQueue.length === 0 ? (
            <p className="text-fine text-muted">Пока нет зарегистрированных поставщиков.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-fine">
                <thead>
                  <tr className="border-rule border-b text-micro text-muted uppercase tracking-wide">
                    <th className="px-2 py-2.5 text-left font-semibold">Поставщик</th>
                    <th className="px-2 py-2.5 text-left font-semibold">Категория</th>
                    <th className="px-2 py-2.5 text-left font-semibold">Город</th>
                    <th className="px-2 py-2.5 text-left font-semibold">Подан</th>
                    <th className="px-2 py-2.5 text-left font-semibold">Статус</th>
                    <th className="px-2 py-2.5 text-left font-semibold">Решение</th>
                  </tr>
                </thead>
                <tbody>
                  {data.verificationQueue.map((v) => (
                    <tr key={v.companyId} className="border-rule border-b last:border-b-0">
                      <td className="px-2 py-3 font-semibold">{v.name}</td>
                      <td className="px-2 py-3 text-muted">
                        {v.category
                          ? (CATEGORY_LABEL[v.category as CatalogCategory] ?? v.category)
                          : '—'}
                      </td>
                      <td className="px-2 py-3 text-muted">{v.city ?? '—'}</td>
                      <td className="px-2 py-3 text-muted">{formatDate(v.submittedAt)}</td>
                      <td className="px-2 py-3">
                        <Stamp tone={STATUS_TONE[v.status]}>{STATUS_LABEL[v.status]}</Stamp>
                      </td>
                      {/* Очередь и действие в одном месте (аудит F11): решение по
                          компании на проверке принимается прямо здесь, тем же server
                          action, что и в «Компаниях». */}
                      <td className="px-2 py-3">
                        {v.status === 'pending' ? (
                          <SupplierVerificationActions companyId={v.companyId} />
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Reveal>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Reveal delay={0.18}>
          <Card>
            <h3 className="mb-4 text-base font-bold">Последние пользователи</h3>
            {data.recentUsers.length === 0 ? (
              <p className="text-fine text-muted">Пока нет пользователей.</p>
            ) : (
              <ul className="flex flex-col gap-3.5">
                {data.recentUsers.map((u) => (
                  <li key={u.userId} className="flex items-center gap-3">
                    <div className="h-9 w-9 shrink-0 rounded-full bg-page" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-fine font-semibold">{u.name}</p>
                      <p className="truncate text-micro text-muted">{u.companyName ?? 'QAJET'}</p>
                    </div>
                    <span className="shrink-0 text-micro font-semibold text-muted">{u.role}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </Reveal>

        <Reveal delay={0.22}>
          <Card>
            <h3 className="mb-4 text-base font-bold">Последние выплаты поставщикам</h3>
            {data.recentPayouts.length === 0 ? (
              <p className="text-fine text-muted">Пока нет выплат.</p>
            ) : (
              <ul className="flex flex-col gap-3.5">
                {data.recentPayouts.map((p) => (
                  <li key={p.payoutId} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-fine font-semibold">{p.orderTitle}</p>
                      <p className="truncate text-micro text-muted">{p.supplierName}</p>
                    </div>
                    <Money amountKzt={p.amountKzt} className="shrink-0 text-fine font-semibold" />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </Reveal>
      </div>
    </div>
  );
}
