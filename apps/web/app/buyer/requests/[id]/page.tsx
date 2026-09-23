import { Reveal, Stamp } from '@qajet/ui/motion';
import { buttonClass, Card, formatKzt } from '@qajet/ui/primitives';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { loadBuyerCase } from '../../../lib/buyer-case';
import { hrefForAction, waitingOnLabel } from '../../../lib/buyer-stage';
import { requireActor } from '../../../lib/current-user';
import { formatDate } from '../../../lib/dates';
import { AttachmentForm } from '../../messages/_attachment-form';
import { BuyerOrderView } from '../../orders/[id]/_order-view';
import { ShareCaseButton } from './_share-button';

/**
 * Закупка покупателя — единственный адрес на всю её жизнь: от отправки формы
 * до закрывающих документов. Заявка существует раньше заказа, поэтому ключом
 * служит она (qajet-master-spec.md §4: «заявка» — `request`). Старые адреса
 * /buyer/orders/[id] перенаправляют сюда.
 *
 * Страница отвечает на три вопроса покупателя — на каком мы этапе, чей ход и
 * что делать дальше, — а ниже показывает либо ход заказа, либо (пока заказа
 * нет) состав заявки.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function BuyerCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await requireActor('buyer');
  const supabase = await createSupabaseServerClient();
  const procurement = await loadBuyerCase(supabase, id, user.role === 'owner');
  if (!procurement) notFound();

  const { description } = procurement;
  const waiting = waitingOnLabel(description.waitingOn);
  const action = description.nextAction;

  return (
    <div className="mx-auto max-w-2xl">
      <p className="mb-4 text-fine text-muted">
        <Link href="/buyer" className="hover:text-ink">
          Закупки
        </Link>
        <span className="mx-1.5">›</span>
        <span className="font-medium text-ink">{procurement.title}</span>
      </p>

      <Reveal>
        <div className="flex items-start justify-between gap-4">
          <div>
            <Stamp tone={description.tone} className="w-fit">
              {description.label}
            </Stamp>
            <h1 className="mt-2 text-2xl font-extrabold text-ink">{procurement.title}</h1>
          </div>
          <ShareCaseButton
            path={`/buyer/requests/${procurement.requestId}`}
            title={procurement.title}
          />
        </div>
      </Reveal>

      <Reveal className="mt-6" from="up">
        <Card padding="sm">
          <p className="text-sm text-ink">{description.headline}</p>
          <dl className="mt-3 flex flex-col gap-2 text-fine">
            {waiting && (
              <div className="flex justify-between border-t border-rule pt-2">
                <dt className="text-muted">Сейчас ход за</dt>
                <dd className="font-semibold text-ink">{waiting}</dd>
              </div>
            )}
            {procurement.expectedAt && (
              <div className="flex justify-between border-t border-rule pt-2">
                <dt className="text-muted">Ожидаемая дата</dt>
                <dd className="font-semibold text-ink">
                  {formatDate(procurement.expectedAt, { day: 'numeric', month: 'long' })}
                </dd>
              </div>
            )}
            <div className="flex justify-between border-t border-rule pt-2">
              <dt className="text-muted">Обновлено</dt>
              <dd className="text-muted">
                {formatDate(procurement.updatedAt, { day: 'numeric', month: 'long' })}
              </dd>
            </div>
          </dl>
          {action && (
            <Link
              href={hrefForAction(action.kind, {
                requestId: procurement.requestId,
                orderId: procurement.orderId,
              })}
              className={`${buttonClass('primary')} mt-4`}
            >
              {action.label}
            </Link>
          )}
        </Card>
      </Reveal>

      <Reveal className="mt-6" from="up">
        <Card padding="sm">
          <p className="text-sm font-bold text-ink">Состав заявки</p>
          <ul className="mt-3 flex flex-col gap-2 text-fine">
            {procurement.items.map((item) => (
              <li key={item.id} className="flex justify-between gap-4 border-t border-rule pt-2">
                <span className="text-ink">{item.name}</span>
                <span className="numeric text-muted">
                  {item.qty.toLocaleString('ru-RU')} {item.unit}
                </span>
              </li>
            ))}
          </ul>
          <dl className="mt-3 flex flex-col gap-2 border-t border-rule pt-3 text-fine text-muted">
            {procurement.city && (
              <div className="flex justify-between">
                <dt>Город доставки</dt>
                <dd className="text-ink">{procurement.city}</dd>
              </div>
            )}
            {procurement.deliveryAddress && (
              <div className="flex justify-between gap-4">
                <dt>Адрес</dt>
                <dd className="text-right text-ink">{procurement.deliveryAddress}</dd>
              </div>
            )}
            {procurement.budgetKzt !== null && (
              <div className="flex justify-between">
                <dt>Бюджет</dt>
                <dd className="numeric text-ink">{formatKzt(procurement.budgetKzt)}</dd>
              </div>
            )}
          </dl>
        </Card>
      </Reveal>

      {procurement.orderId ? (
        <BuyerOrderView orderId={procurement.orderId} />
      ) : (
        <Reveal className="mt-6" from="up">
          <Card padding="sm">
            <p className="text-sm font-bold text-ink">Есть готовое ТЗ или брендбук?</p>
            <p className="mt-1 text-fine text-muted">
              Прикрепите файл к заявке — он останется приватным и будет доступен только участникам
              этой закупки.
            </p>
            <AttachmentForm
              requestId={procurement.requestId}
              returnPath={`/buyer/requests/${procurement.requestId}`}
              kind="spec"
            />
          </Card>
        </Reveal>
      )}
    </div>
  );
}
