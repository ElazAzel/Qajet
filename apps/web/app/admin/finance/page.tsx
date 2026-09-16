import { Reveal, Stagger } from '@qajet/ui/motion';
import { Money, StatTile } from '@qajet/ui/primitives';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { loadAdminFinance } from '../../lib/admin-finance';

/**
 * Сверка предоплат/выплат/резервов — agents.md §10 «Админ → Финансы».
 * См. `admin-finance.ts` для того, что означает «резерв» здесь.
 */
export default async function AdminFinancePage() {
  const supabase = await createSupabaseServerClient();
  const finance = await loadAdminFinance(supabase);

  return (
    <div className="flex flex-col gap-6">
      <Reveal>
        <h1 className="text-2xl font-extrabold text-ink">Финансы</h1>
        <p className="mt-1.5 text-fine text-muted">
          Сверка предоплат покупателей и выплат поставщикам по заявкам.
        </p>
      </Reveal>

      <Stagger startIndex={1} as="div" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile
          value={<Money amountKzt={finance.totalPrepaidKzt} className="text-xl font-semibold" />}
          title="Принято предоплат"
        />
        <StatTile
          value={<Money amountKzt={finance.totalPaidOutKzt} className="text-xl font-semibold" />}
          title="Выплачено поставщикам"
        />
        <StatTile
          value={<Money amountKzt={finance.reserveKzt} className="text-xl font-semibold" />}
          title="В резерве"
          note="Принято, но ещё не разнесено в выплату"
        />
      </Stagger>

      <Reveal delay={0.14} className="overflow-x-auto rounded-card border border-rule bg-surface">
        <table className="w-full text-fine">
          <thead>
            <tr className="border-rule border-b text-left text-micro text-muted uppercase">
              <th className="px-4 py-3">Заявка</th>
              <th className="px-4 py-3">Покупатель</th>
              <th className="px-4 py-3 text-right">Предоплата</th>
              <th className="px-4 py-3 text-right">Выплачено</th>
              <th className="px-4 py-3 text-right">Резерв</th>
            </tr>
          </thead>
          <tbody>
            {finance.rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-5 text-center text-muted">
                  Пока нет предоплат.
                </td>
              </tr>
            ) : (
              finance.rows.map((row) => (
                <tr key={row.requestId} className="border-rule border-b last:border-b-0">
                  <td className="max-w-xs truncate px-4 py-3 text-ink">{row.requestTitle}</td>
                  <td className="px-4 py-3 text-muted">{row.buyerCompany}</td>
                  <td className="px-4 py-3 text-right numeric">
                    <Money amountKzt={row.prepaidKzt} />
                  </td>
                  <td className="px-4 py-3 text-right numeric">
                    <Money amountKzt={row.payoutKzt} />
                  </td>
                  <td className="px-4 py-3 text-right numeric font-semibold">
                    <Money amountKzt={row.prepaidKzt - row.payoutKzt} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Reveal>
    </div>
  );
}
