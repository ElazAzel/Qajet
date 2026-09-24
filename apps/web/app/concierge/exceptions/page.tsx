import { Reveal, Stamp } from '@qajet/ui/motion';
import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { EXCEPTION_LABEL, loadConciergeExceptions } from '../../lib/concierge-exceptions';
import { requireActor } from '../../lib/current-user';
import { formatDate } from '../../lib/dates';

/**
 * Обработка исключений — agents.md §10 «Консьерж → Исключения». См.
 * `concierge-exceptions.ts`.
 */
export default async function ConciergeExceptionsPage() {
  await requireActor('concierge');
  const supabase = await createSupabaseServerClient();
  const rows = await loadConciergeExceptions(supabase);

  return (
    <div className="flex flex-col gap-6">
      <Reveal>
        <h1 className="text-2xl font-extrabold text-ink">Исключения</h1>
        <p className="mt-1.5 text-fine text-muted">
          {rows.length === 0
            ? 'Ничего не требует решения прямо сейчас.'
            : `${rows.length} заказов требуют решения.`}
        </p>
      </Reveal>

      {rows.length > 0 && (
        <Reveal delay={0.08} className="rounded-card border border-rule bg-surface">
          <ul>
            {rows.map((row) => (
              <li key={row.orderId} className="border-rule border-b px-5 py-4 last:border-b-0">
                <Link
                  href={`/concierge/orders/${row.orderId}`}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{row.requestTitle}</p>
                    <p className="truncate text-fine text-muted">
                      {row.buyerCompany} ·{' '}
                      {row.kind === 'silent_supplier'
                        ? `ответ до ${formatDate(row.since)}`
                        : `с ${formatDate(row.since)}`}
                    </p>
                    {row.note && <p className="mt-1 text-micro text-muted">{row.note}</p>}
                  </div>
                  <Stamp tone={row.kind === 'on_hold' ? 'neutral' : 'signal'} className="shrink-0">
                    {EXCEPTION_LABEL[row.kind]}
                  </Stamp>
                </Link>
                {/* Напоминание — одно нажатие: WhatsApp открывается с готовым текстом,
                    консьерж отправляет его сам. Без номера — честно сказано, что звонить. */}
                {row.reminders && row.reminders.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {row.reminders.map((reminder) => (
                      <li key={reminder.supplierName}>
                        {reminder.whatsappUrl ? (
                          <a
                            href={reminder.whatsappUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-block rounded-control border border-rule px-3 py-1.5 text-fine font-semibold text-ink hover:border-purple"
                          >
                            Напомнить в WhatsApp: {reminder.supplierName}
                          </a>
                        ) : (
                          <span className="inline-block px-1 py-1.5 text-fine text-muted">
                            {reminder.supplierName}: WhatsApp не указан — позвоните
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </Reveal>
      )}
    </div>
  );
}
