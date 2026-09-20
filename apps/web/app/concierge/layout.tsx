import { Stamp } from '@qajet/ui/motion';
import { ConciergeShell, KeyboardListNav } from '@qajet/ui/shell';
import { AlertCircle, LayoutList } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { formatBoardDeadline } from '../lib/board-row';
import { loadBlockedOrders } from '../lib/concierge-blocked';
import { requireActor, shellUserFrom } from '../lib/current-user';
import {
  ORDER_STATE_LABEL,
  ORDER_STATE_PRIORITY,
  ORDER_STATE_TONE,
  ORDER_TURN,
  type OrderState,
} from '../lib/order-state';
import { IntakeButton } from './_intake-button';

// «Шаблоны» убраны из навигации — /concierge/templates не реализован, вёл на 404.
const NAV_ITEMS = [
  { key: 'orders', href: '/concierge', label: 'Заказы', icon: <LayoutList size={18} /> },
  {
    key: 'exceptions',
    href: '/concierge/exceptions',
    label: 'Исключения',
    icon: <AlertCircle size={18} />,
  },
];

interface BoardRow {
  id: string;
  state: OrderState;
  title: string;
  buyerCompany: string;
  deadlineDate: string | null;
  blocked: boolean;
}

async function loadBoard(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  // deadline_date берётся из уже существующего вложения requests — без лишнего запроса.
  const { data } = await supabase
    .from('orders')
    .select('id, request_id, state, requests(title, deadline_date, companies(name))')
    .not('state', 'in', '(closed,cancelled)');

  const rows = (data ?? []).map((row) => {
    const request = Array.isArray(row.requests) ? row.requests[0] : row.requests;
    const company = request
      ? Array.isArray(request.companies)
        ? request.companies[0]
        : request.companies
      : null;
    return {
      id: row.id,
      requestId: row.request_id as string,
      state: row.state as OrderState,
      title: request?.title ?? '—',
      buyerCompany: company?.name ?? '—',
      deadlineDate: (request?.deadline_date as string | null) ?? null,
    };
  });

  // Тупик возможен только там, где консьерж собирает план, поэтому кандидаты —
  // одна стадия. Пустой список кандидатов не стоит ни одного запроса.
  const blocked = await loadBlockedOrders(
    supabase,
    rows
      .filter((row) => row.state === 'quotes_received')
      .map((row) => ({ orderId: row.id, requestId: row.requestId })),
  );

  const board: BoardRow[] = rows.map((row) => ({
    id: row.id,
    state: row.state,
    title: row.title,
    buyerCompany: row.buyerCompany,
    deadlineDate: row.deadlineDate,
    blocked: blocked.has(row.id),
  }));

  return board.sort((a, b) => ORDER_STATE_PRIORITY[a.state] - ORDER_STATE_PRIORITY[b.state]);
}

interface PendingRequestRow {
  id: string;
  title: string;
  city: string | null;
  buyerCompany: string;
}

/** Заявки, поданные покупателем, но ещё не взятые в работу — до intakeRequest()
 *  у них физически нет строки в orders, поэтому доска заказов их не видит. */
async function loadPendingRequests(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
): Promise<PendingRequestRow[]> {
  const [{ data: submitted }, { data: orderedRows }] = await Promise.all([
    supabase
      .from('requests')
      .select('id, title, city, companies(name)')
      .eq('status', 'submitted')
      .order('created_at', { ascending: true }),
    supabase.from('orders').select('request_id'),
  ]);

  const orderedRequestIds = new Set((orderedRows ?? []).map((o) => o.request_id));

  return (submitted ?? [])
    .filter((row) => !orderedRequestIds.has(row.id))
    .map((row) => {
      const company = Array.isArray(row.companies) ? row.companies[0] : row.companies;
      return { id: row.id, title: row.title, city: row.city, buyerCompany: company?.name ?? '—' };
    });
}

export default async function ConciergeLayout({ children }: { children: ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const [user, board, pendingRequests] = await Promise.all([
    requireActor('concierge'),
    loadBoard(supabase),
    loadPendingRequests(supabase),
  ]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <ConciergeShell
      navItems={NAV_ITEMS}
      user={shellUserFrom(user)}
      list={
        <div>
          {pendingRequests.length > 0 && (
            <div className="border-b border-rule bg-purple-10">
              <div className="p-4 pb-2">
                <p className="text-micro tracking-wide text-purple uppercase">
                  Новые заявки · {pendingRequests.length}
                </p>
              </div>
              <div className="flex flex-col">
                {pendingRequests.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-3 border-t border-purple/10 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{row.title}</p>
                      <p className="truncate text-fine text-muted">
                        {row.buyerCompany} · {row.city ?? '—'}
                      </p>
                    </div>
                    <IntakeButton requestId={row.id} />
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="border-b border-rule p-4">
            <p className="text-micro tracking-wide text-muted uppercase">
              Доска заказов · {board.length} активных
            </p>
          </div>
          {board.length === 0 ? (
            <p className="p-4 text-fine text-muted">
              Пока нет заказов в работе — они появятся здесь сразу после «Взять в работу».
            </p>
          ) : (
            <KeyboardListNav>
              <div className="flex flex-col">
                {board.map((row) => {
                  const deadline = formatBoardDeadline(row.deadlineDate, today);
                  return (
                    <Link
                      key={row.id}
                      href={`/concierge/orders/${row.id}`}
                      data-kbd-row
                      className="flex flex-col gap-1.5 border-b border-rule px-4 py-3 hover:bg-page"
                    >
                      <span className="text-sm font-semibold text-ink">{row.title}</span>
                      <span className="text-fine text-muted">{row.buyerCompany}</span>
                      {/* Ответ на утренний вопрос: у кого мяч и что горит (F6).
                          Просрочка несётся словом, а не только цветом. */}
                      <span className="text-micro text-muted">
                        {ORDER_TURN[row.state].label}
                        <span className={deadline.overdue ? 'text-signal' : undefined}>
                          {' · '}
                          {deadline.text}
                        </span>
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Stamp tone={ORDER_STATE_TONE[row.state]}>
                          {ORDER_STATE_LABEL[row.state]}
                        </Stamp>
                        {/* Формулировка намеренно отличается от фразы на экране
                            заказа: getByText ищет подстроку, и совпадение сделало
                            бы проверки сценариев неоднозначными. */}
                        {row.blocked && <Stamp tone="signal">Заблокирован</Stamp>}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </KeyboardListNav>
          )}
        </div>
      }
      detail={children}
    />
  );
}
