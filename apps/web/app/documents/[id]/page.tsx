import { Card, formatKzt } from '@qajet/ui/primitives';
import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireCurrentUser } from '../../lib/current-user';
import type { ActItem, QajetRequisites } from '../../lib/documents';

/**
 * Просмотрщик документов Document Engine (agents.md §11.3, §14 шаг 11) —
 * счёт на предоплату / акт выполненных работ, пишутся в order-actions.ts
 * (../../lib/documents.ts) при переходе стадии заказа. Не PDF — структура
 * данных из `documents.meta`, отрендеренная как обычная страница; RLS
 * `documents_select_via_order` уже решает, кто видит (покупатель заказа
 * или staff — supplier_invoice сюда не попадает, только prepay_invoice/
 * act/final_invoice).
 *
 * `final_invoice` — старый тип, которым packages/db/src/seed/generator.ts
 * помечает закрывающий документ демо-истории (24 закрытых заказа, `meta:
 * {}` — placeholder до этой правки); рендерится тем же блоком, что новый
 * 'act', с честным «—» вместо undefined там, где старая запись пустая.
 *
 * Отдельный от ролевых оболочек маршрут (тот же приём, что /metrics) —
 * документ открывают и покупатель, и консьерж по одной и той же ссылке.
 */

interface PrepayInvoiceMeta {
  invoiceNo?: string;
  amountKzt?: number;
  buyerCompany?: { name: string; bin: string | null } | null;
  qajetRequisites?: QajetRequisites | null;
  issuedAt?: string;
}

interface ActMeta {
  actNo?: string;
  buyerCompany?: { name: string; bin: string | null } | null;
  qajetRequisites?: QajetRequisites | null;
  planTotalKzt?: number;
  settlement?: 'refund' | 'surcharge' | 'exact';
  settlementAmountKzt?: number;
  finalCostKzt?: number;
  items?: ActItem[];
  closedAt?: string;
}

const SETTLEMENT_LABEL: Record<string, string> = {
  refund: 'Возврат',
  surcharge: 'Доплата',
  exact: 'Точно по плану',
};

function formatDate(iso: string | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function RequisitesBlock({ requisites }: { requisites: QajetRequisites | null | undefined }) {
  if (!requisites) return <p className="text-fine text-muted">—</p>;
  return (
    <div className="text-fine text-muted">
      <p className="font-semibold text-ink">{requisites.legalName}</p>
      <p>БИН {requisites.bin}</p>
      <p>{requisites.address}</p>
      <p>
        {requisites.bankName}, IBAN {requisites.iban}, БИК {requisites.bik}
      </p>
      <p>
        {requisites.phone} · {requisites.email}
      </p>
    </div>
  );
}

export default async function DocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  await requireCurrentUser();
  const { id: orderId } = await params;
  const { type } = await searchParams;
  const supabase = await createSupabaseServerClient();

  const query = supabase
    .from('documents')
    .select('type, meta, created_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(1);
  const { data: document } = type
    ? await query.eq('type', type).maybeSingle()
    : await query.maybeSingle();
  if (!document) notFound();

  if (document.type === 'prepay_invoice') {
    const meta = document.meta as PrepayInvoiceMeta;
    return (
      <div className="mx-auto max-w-xl px-6 py-10">
        <p className="text-micro tracking-wide text-muted uppercase">Счёт на предоплату</p>
        <h1 className="mt-1 text-2xl font-extrabold text-ink">{meta.invoiceNo ?? '—'}</h1>
        <p className="mt-1 text-sm text-muted">от {formatDate(meta.issuedAt)}</p>

        <Card padding="sm" className="mt-6">
          <p className="text-fine font-semibold text-muted">Исполнитель</p>
          <div className="mt-2">
            <RequisitesBlock requisites={meta.qajetRequisites} />
          </div>
        </Card>

        <Card padding="sm" className="mt-4">
          <p className="text-fine font-semibold text-muted">Заказчик</p>
          <p className="mt-2 font-semibold text-ink">{meta.buyerCompany?.name ?? '—'}</p>
          {meta.buyerCompany?.bin && (
            <p className="text-fine text-muted">БИН {meta.buyerCompany.bin}</p>
          )}
        </Card>

        <Card padding="sm" className="mt-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">Сумма к оплате</span>
            <span className="text-2xl font-extrabold text-ink">
              {formatKzt(meta.amountKzt ?? 0)}
            </span>
          </div>
          <p className="mt-1 text-fine text-muted">50% от оценки — предоплата без эквайринга.</p>
        </Card>
      </div>
    );
  }

  if (document.type === 'act' || document.type === 'final_invoice') {
    const meta = document.meta as ActMeta;
    const items = meta.items ?? [];
    return (
      <div className="mx-auto max-w-xl px-6 py-10">
        <p className="text-micro tracking-wide text-muted uppercase">Акт выполненных работ</p>
        <h1 className="mt-1 text-2xl font-extrabold text-ink">{meta.actNo ?? '—'}</h1>
        <p className="mt-1 text-sm text-muted">от {formatDate(meta.closedAt)}</p>

        <Card padding="sm" className="mt-6">
          <p className="text-fine font-semibold text-muted">Исполнитель</p>
          <div className="mt-2">
            <RequisitesBlock requisites={meta.qajetRequisites} />
          </div>
        </Card>

        <Card padding="sm" className="mt-4">
          <p className="text-fine font-semibold text-muted">Заказчик</p>
          <p className="mt-2 font-semibold text-ink">{meta.buyerCompany?.name ?? '—'}</p>
          {meta.buyerCompany?.bin && (
            <p className="text-fine text-muted">БИН {meta.buyerCompany.bin}</p>
          )}
        </Card>

        {items.length > 0 && (
          <Card padding="sm" className="mt-4">
            <p className="text-fine font-semibold text-muted">Позиции</p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {items.map((item) => (
                <li key={item.name} className="flex items-center justify-between text-fine">
                  <span className="text-ink">{item.name}</span>
                  <span className="numeric text-muted">
                    {item.qty} {item.unit}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card padding="sm" className="mt-4">
          <div className="flex items-center justify-between text-fine">
            <span className="text-muted">Стоимость плана</span>
            <span className="numeric text-ink">{formatKzt(meta.planTotalKzt ?? 0)}</span>
          </div>
          {meta.settlement && (
            <div className="mt-1.5 flex items-center justify-between text-fine">
              <span className="text-muted">{SETTLEMENT_LABEL[meta.settlement]}</span>
              <span className="numeric text-ink">
                {(meta.settlementAmountKzt ?? 0) > 0 ? '+' : ''}
                {formatKzt(meta.settlementAmountKzt ?? 0)}
              </span>
            </div>
          )}
          <div className="mt-2 flex items-center justify-between border-t border-rule pt-2">
            <span className="font-semibold text-ink">Итого</span>
            <span className="text-xl font-extrabold text-ink">
              {formatKzt(meta.finalCostKzt ?? meta.planTotalKzt ?? 0)}
            </span>
          </div>
        </Card>
      </div>
    );
  }

  notFound();
}
