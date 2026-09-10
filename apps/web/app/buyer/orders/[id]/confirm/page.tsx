import { Reveal } from '@qajet/ui/motion';
import { Card, formatKzt } from '@qajet/ui/primitives';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireCurrentUser } from '../../../../lib/current-user';
import {
  loadOrderConfirmation,
  PAYMENT_TERMS,
  RETURN_TERMS,
} from '../../../../lib/order-confirmation';
import { ConfirmPlanCta } from './_confirm-cta';

/**
 * Экран подтверждения заказа — agents.md §11.3. Спека требует именно
 * ЗАФИКСИРОВАТЬ И ПОКАЗАТЬ перед утверждением: юрлицо QAJET, БИН, цену,
 * статус НДС, состав, количество, срок, адрес и способ доставки, порядок
 * оплаты, условия возврата — и сохранить audit log «кто → когда → какую
 * версию плана → подтвердил».
 *
 * До этого экрана покупатель утверждал план кнопкой прямо на карточке
 * заказа: ни одного реквизита перед ним не показывалось, а в
 * `order_stage_events` не попадало, КАКУЮ версию плана он утвердил.
 * Версия теперь пишется в `note` того же события (approvePlan,
 * order-actions.ts) — отдельной таблицы аудита для этого не нужно, «кто»
 * и «когда» там уже есть.
 */

export default async function ConfirmOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireCurrentUser();
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const confirmation = await loadOrderConfirmation(supabase, id);
  if (!confirmation) notFound();

  const { qajet, buyerCompany } = confirmation;

  return (
    <div className="mx-auto max-w-2xl">
      <Reveal className="mb-6">
        <Link href={`/buyer/orders/${id}`} className="text-fine font-semibold text-purple">
          ← К заказу
        </Link>
        <h1 className="mt-2 text-3xl font-extrabold">Подтверждение заказа</h1>
        <p className="mt-2 text-sm text-muted">
          Проверьте условия перед подтверждением. После подтверждения план фиксируется: изменение
          создаёт новую версию, а не правит утверждённую.
        </p>
      </Reveal>

      <Reveal className="mb-4">
        <Card padding="sm">
          <p className="text-fine font-semibold text-muted">Исполнитель</p>
          {qajet ? (
            <div className="mt-2 text-fine text-muted">
              <p className="font-semibold text-ink">{qajet.legalName}</p>
              <p>БИН {qajet.bin}</p>
              <p>{qajet.address}</p>
              <p>
                {qajet.bankName}, IBAN {qajet.iban}, БИК {qajet.bik}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-fine text-muted">—</p>
          )}
        </Card>
      </Reveal>

      <Reveal className="mb-4">
        <Card padding="sm">
          <p className="text-fine font-semibold text-muted">Заказчик</p>
          <p className="mt-2 font-semibold text-ink">{buyerCompany?.name ?? '—'}</p>
          {buyerCompany?.bin && <p className="text-fine text-muted">БИН {buyerCompany.bin}</p>}
          <p className="text-fine text-muted">{buyerCompany?.vatStatusLabel ?? '—'}</p>
        </Card>
      </Reveal>

      <Reveal className="mb-4">
        <Card padding="sm">
          <p className="text-fine font-semibold text-muted">Состав заказа</p>
          <p className="mt-1 text-sm font-semibold text-ink">{confirmation.requestTitle}</p>
          <ul className="mt-3 flex flex-col gap-1.5">
            {confirmation.items.map((item) => (
              <li key={item.name} className="flex items-center justify-between text-fine">
                <span className="text-ink">{item.name}</span>
                <span className="numeric text-muted">
                  {item.qty} {item.unit}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </Reveal>

      <Reveal className="mb-4">
        <Card padding="sm">
          <p className="text-fine font-semibold text-muted">Срок и доставка</p>
          <dl className="mt-2 flex flex-col gap-1.5 text-fine">
            <Row label="Плановый срок" value={confirmation.etaDate ?? '—'} />
            <Row label="Дедлайн заявки" value={confirmation.deadlineDate ?? '—'} />
            <Row
              label="Адрес доставки"
              value={confirmation.deliveryAddress ?? confirmation.city ?? '—'}
            />
            <Row label="Способ доставки" value="Доставка силами QAJET до указанного адреса" />
          </dl>
        </Card>
      </Reveal>

      <Reveal className="mb-4">
        <Card padding="sm">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">Стоимость исполнения заказа</span>
            <span className="text-2xl font-extrabold text-ink">
              {formatKzt(confirmation.totalKzt)}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-rule pt-2 text-fine">
            <span className="text-muted">в том числе доставка</span>
            <span className="numeric text-ink">{formatKzt(confirmation.deliveryKzt)}</span>
          </div>
          <p className="mt-2 text-fine text-muted">Версия плана {confirmation.planVersion}</p>
        </Card>
      </Reveal>

      <Reveal className="mb-4">
        <Card padding="sm">
          <p className="text-fine font-semibold text-muted">Порядок оплаты</p>
          <p className="mt-2 text-fine text-muted">{PAYMENT_TERMS}</p>
        </Card>
      </Reveal>

      <Reveal className="mb-6">
        <Card padding="sm">
          <p className="text-fine font-semibold text-muted">Условия возврата и сверки</p>
          <p className="mt-2 text-fine text-muted">{RETURN_TERMS}</p>
        </Card>
      </Reveal>

      <Reveal from="up">
        <ConfirmPlanCta orderId={id} planVersion={confirmation.planVersion} />
      </Reveal>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right text-ink">{value}</dd>
    </div>
  );
}
