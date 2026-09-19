import { Reveal, Stamp } from '@qajet/ui/motion';
import { buttonClass, Card } from '@qajet/ui/primitives';
import { FilePlus } from 'lucide-react';
import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { type BuyerCaseSummary, loadBuyerCases } from '../lib/buyer-case';
import { hrefForAction, isBuyerTurn, waitingOnLabel } from '../lib/buyer-stage';
import { requireActor } from '../lib/current-user';
import { BuyerHero } from './_hero';

/**
 * Главная покупателя — список закупок. Заявка попадает сюда сразу после
 * отправки формы, а не тогда, когда консьерж заведёт заказ. Наверху те
 * закупки, где сейчас ход покупателя: он видит, что от него ждут, не
 * открывая каждую.
 */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export default async function BuyerHome() {
  const user = await requireActor('buyer');
  const supabase = await createSupabaseServerClient();
  const cases = await loadBuyerCases(supabase, user.role === 'owner');
  const waiting = cases.filter((c) => isBuyerTurn(c.description));
  const rest = cases.filter((c) => !isBuyerTurn(c.description));

  return (
    <div className="flex flex-col gap-6">
      <Reveal from="up">
        <BuyerHero />
      </Reveal>

      {cases.length === 0 ? (
        <Reveal>
          <Card className="flex flex-col items-start gap-3 py-8">
            <h2 className="text-lg font-bold text-ink">Закупок пока нет</h2>
            <p className="max-w-md text-sm text-muted">
              Опишите задачу — консьерж оценит стоимость, соберёт предложения исполнителей и
              проведёт заказ до закрывающих документов.
            </p>
            <Link href="/buyer/requests/new" className={buttonClass('primary')}>
              <FilePlus size={16} aria-hidden="true" />
              Создать заявку
            </Link>
          </Card>
        </Reveal>
      ) : (
        <>
          {waiting.length > 0 && (
            <Reveal>
              <Card>
                <h2 className="text-lg font-bold text-ink">Ждут вашего решения</h2>
                <div className="mt-3 flex flex-col">
                  {waiting.map((item) => (
                    <WaitingRow key={item.requestId} item={item} />
                  ))}
                </div>
              </Card>
            </Reveal>
          )}

          <Reveal from="up">
            <Card>
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-lg font-bold text-ink">
                  {waiting.length > 0 ? 'Остальные закупки' : 'Все закупки'}
                </h2>
                <Link href="/buyer/requests/new" className={buttonClass('primary', 'sm')}>
                  <FilePlus size={14} aria-hidden="true" />
                  Новая заявка
                </Link>
              </div>
              {rest.length === 0 ? (
                <p className="py-6 text-sm text-muted">Других закупок нет.</p>
              ) : (
                <ul className="mt-3 flex flex-col">
                  {rest.map((item) => (
                    <CaseRow key={item.requestId} item={item} />
                  ))}
                </ul>
              )}
            </Card>
          </Reveal>
        </>
      )}

      <p className="text-fine text-muted">
        <Link href="/buyer/reorder" className="font-semibold text-purple hover:underline">
          Повторить прошлый заказ
        </Link>
        <span className="mx-2" aria-hidden="true">
          ·
        </span>
        <Link href="/buyer/analytics" className="font-semibold text-purple hover:underline">
          Аналитика закупок
        </Link>
      </p>
    </div>
  );
}

function WaitingRow({ item }: { item: BuyerCaseSummary }) {
  const { description } = item;
  const action = description.nextAction;
  return (
    <div className="flex flex-col gap-2 border-t border-rule py-3 first:border-t-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <Link
          href={`/buyer/requests/${item.requestId}`}
          className="block truncate text-sm font-semibold text-ink hover:text-purple"
        >
          {item.title}
        </Link>
        <p className="mt-0.5 text-fine text-muted">{description.headline}</p>
      </div>
      {action ? (
        <Link
          href={hrefForAction(action.kind, { requestId: item.requestId, orderId: item.orderId })}
          className={`${buttonClass('primary', 'sm')} shrink-0`}
        >
          {action.label}
        </Link>
      ) : (
        <Stamp tone={description.tone} className="w-fit shrink-0">
          {description.label}
        </Stamp>
      )}
    </div>
  );
}

function CaseRow({ item }: { item: BuyerCaseSummary }) {
  const { description } = item;
  const waiting = waitingOnLabel(description.waitingOn);
  return (
    <li className="border-t border-rule first:border-t-0">
      <Link
        href={`/buyer/requests/${item.requestId}`}
        className="-mx-2 flex flex-col gap-1 rounded-control px-2 py-3 hover:bg-page sm:flex-row sm:items-center sm:gap-4"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{item.title}</p>
          <p className="mt-0.5 truncate text-fine text-muted">
            {waiting ? `Ход за: ${waiting}` : description.headline}
            {item.expectedAt ? ` · к ${formatDate(item.expectedAt)}` : ''}
          </p>
        </div>
        <Stamp tone={description.tone} className="w-fit shrink-0">
          {description.label}
        </Stamp>
      </Link>
    </li>
  );
}
