import { Reveal, Stagger } from '@qajet/ui/motion';
import { Button } from '@qajet/ui/primitives';

/**
 * Повтор заказа по истории — agents.md §10 «Покупатель»: личность
 * исполнителя покупателю не раскрывается, повтор идёт по истории СВОИХ
 * заказов через QAJET, не по каталогу исполнителей. Раньше здесь была
 * витрина карточек компаний-исполнителей — прямое нарушение этого правила.
 * До реального подключения к orders/plans — макет по категориям заказа,
 * без единого названия исполнителя.
 */

interface ReorderCard {
  title: string;
  category: string;
  lastOrderedAt: string;
  timesOrdered: number;
}

const REORDERS: ReorderCard[] = [
  {
    title: 'Футболки с логотипом, 50 шт',
    category: 'Печать и мерч',
    lastOrderedAt: 'июль 2026',
    timesOrdered: 6,
  },
  {
    title: 'Буклеты А5, 200 шт',
    category: 'Полиграфия',
    lastOrderedAt: 'июнь 2026',
    timesOrdered: 3,
  },
  {
    title: 'Подарочные наборы, 30 шт',
    category: 'Подарки и наборы',
    lastOrderedAt: 'май 2026',
    timesOrdered: 2,
  },
  {
    title: 'Организация корпоратива, 80 чел.',
    category: 'Мероприятия',
    lastOrderedAt: 'апрель 2026',
    timesOrdered: 1,
  },
];

export default function BuyerReorderPage() {
  return (
    <div>
      <Reveal className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold">Повтор заказа</h1>
          <p className="mt-2 text-sm text-muted">
            Заказы, которые вы уже делали через QAJET. Повторите с новым количеством в один клик —
            кто именно исполнит заказ, подбирает QAJET.
          </p>
        </div>
        <Button variant="secondary">Новая заявка</Button>
      </Reveal>

      <Stagger
        startIndex={1}
        as="div"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {REORDERS.map((r) => (
          <div key={r.title} className="rounded-card border border-rule bg-surface p-5">
            <p className="mb-1 text-sm font-semibold">{r.title}</p>
            <p className="mb-3 text-fine text-muted">{r.category}</p>
            <div className="flex justify-between border-rule border-t pt-3 text-fine text-muted">
              <span>
                {r.timesOrdered} {pluralOrders(r.timesOrdered)} · последний {r.lastOrderedAt}
              </span>
            </div>
          </div>
        ))}
      </Stagger>
    </div>
  );
}

function pluralOrders(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'раз';
  return 'раза';
}
