import { Reveal, Stagger } from '@qajet/ui/motion';
import { buttonClass } from '@qajet/ui/primitives';
import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { loadReorderCandidates } from '../../lib/buyer-reorder';
import { ReorderCard } from './_reorder-card';

/**
 * Повтор заказа по истории — agents.md §10 «Покупатель»: личность
 * исполнителя не раскрывается, повтор идёт по истории СВОИХ заказов через
 * QAJET, не по каталогу исполнителей.
 *
 * До этой правки экран показывал четыре выдуманные карточки («Футболки с
 * логотипом, 50 шт, последний июль 2026») — несуществующую историю закупок
 * покупателя, при том что в базе лежат его настоящие закрытые заказы.
 */

export default async function BuyerReorderPage() {
  const supabase = await createSupabaseServerClient();
  const candidates = await loadReorderCandidates(supabase);

  return (
    <div>
      <Reveal className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold">Повтор заказа</h1>
          <p className="mt-2 text-sm text-muted">
            Позиции из ваших закрытых заказов. Повторите с новым количеством в один клик — кто
            именно исполнит заказ, подбирает QAJET.
          </p>
        </div>
        <Link href="/buyer/requests/new" className={buttonClass('secondary')}>
          Новая заявка
        </Link>
      </Reveal>

      {candidates.length === 0 ? (
        <Reveal className="rounded-card border border-rule bg-surface p-8 text-center">
          <p className="text-sm font-semibold">Повторять пока нечего</p>
          <p className="mx-auto mt-2 max-w-sm text-fine text-muted">
            Здесь появятся позиции из ваших закрытых заказов. Первый заказ нужно завести обычной
            заявкой.
          </p>
          <Link href="/buyer/requests/new" className={buttonClass('primary', 'sm', 'mt-4')}>
            Создать заявку
          </Link>
        </Reveal>
      ) : (
        <Stagger
          startIndex={1}
          as="div"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {candidates.map((candidate) => (
            <ReorderCard key={candidate.name} candidate={candidate} />
          ))}
        </Stagger>
      )}
    </div>
  );
}
