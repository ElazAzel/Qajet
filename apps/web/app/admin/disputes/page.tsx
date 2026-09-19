import { Reveal, Stamp } from '@qajet/ui/motion';
import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { loadAdminDisputes } from '../../lib/admin-disputes';
import { requireActor } from '../../lib/current-user';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Журнал споров — agents.md §10 «Админ → Споры». См. `admin-disputes.ts`.
 */
export default async function AdminDisputesPage() {
  await requireActor('admin');
  const supabase = await createSupabaseServerClient();
  const disputes = await loadAdminDisputes(supabase);
  const open = disputes.filter((d) => !d.isResolved);
  const resolved = disputes.filter((d) => d.isResolved);

  return (
    <div className="flex flex-col gap-6">
      <Reveal>
        <h1 className="text-2xl font-extrabold text-ink">Споры</h1>
        <p className="mt-1.5 text-fine text-muted">
          {open.length} открыто, {resolved.length} разрешено.
        </p>
      </Reveal>

      <Reveal delay={0.08} className="rounded-card border border-rule bg-surface">
        <div className="border-rule border-b p-5">
          <h2 className="text-base font-bold text-ink">Открытые</h2>
        </div>
        {open.length === 0 ? (
          <p className="p-5 text-fine text-muted">Открытых споров нет.</p>
        ) : (
          <ul>
            {open.map((d) => (
              <li key={d.orderId} className="border-rule border-b px-5 py-4 last:border-b-0">
                <Link
                  href={`/concierge/orders/${d.orderId}`}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{d.requestTitle}</p>
                    <p className="truncate text-fine text-muted">
                      {d.buyerCompany} · с {formatDate(d.disputedAt)}
                    </p>
                  </div>
                  <Stamp tone="signal" className="shrink-0">
                    Открыт
                  </Stamp>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Reveal>

      {resolved.length > 0 && (
        <Reveal delay={0.14} className="rounded-card border border-rule bg-surface">
          <div className="border-rule border-b p-5">
            <h2 className="text-base font-bold text-ink">Разрешённые</h2>
          </div>
          <ul>
            {resolved.map((d) => (
              <li key={d.orderId} className="border-rule border-b px-5 py-3 last:border-b-0">
                <Link
                  href={`/concierge/orders/${d.orderId}`}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-fine font-semibold text-ink">{d.requestTitle}</p>
                    <p className="truncate text-micro text-muted">{d.buyerCompany}</p>
                  </div>
                  <Stamp tone="progress" className="shrink-0">
                    Разрешён
                  </Stamp>
                </Link>
              </li>
            ))}
          </ul>
        </Reveal>
      )}
    </div>
  );
}
