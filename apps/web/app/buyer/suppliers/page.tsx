import { Reveal, Stagger, Stamp } from '@qajet/ui/motion';
import { Button } from '@qajet/ui/primitives';

/**
 * Сохранённые поставщики покупателя — §10 «Покупатель»: повтор заказа
 * своим проверенным партнёрам. Раздел supplier_profiles/supplier_stats
 * (agents.md §5) даёт рейтинг и историю; здесь — визуальная витрина
 * карточек без реального подбора.
 */

interface SupplierCard {
  name: string;
  category: string;
  city: string;
  ordersWithUs: number;
  buyerScore: number;
  reviewCount: number;
  verified: boolean;
}

const SUPPLIERS: SupplierCard[] = [
  {
    name: 'Uka Print',
    category: 'Печать и мерч',
    city: 'Алматы',
    ordersWithUs: 6,
    buyerScore: 4.9,
    reviewCount: 128,
    verified: true,
  },
  {
    name: 'PrintLab',
    category: 'Полиграфия',
    city: 'Алматы',
    ordersWithUs: 3,
    buyerScore: 4.7,
    reviewCount: 86,
    verified: true,
  },
  {
    name: 'Goodies KZ',
    category: 'Подарки и наборы',
    city: 'Астана',
    ordersWithUs: 2,
    buyerScore: 4.6,
    reviewCount: 52,
    verified: true,
  },
  {
    name: 'Eventoria',
    category: 'Организация мероприятий',
    city: 'Алматы',
    ordersWithUs: 1,
    buyerScore: 4.8,
    reviewCount: 64,
    verified: true,
  },
  {
    name: 'Alma Design',
    category: 'Полиграфия',
    city: 'Алматы',
    ordersWithUs: 1,
    buyerScore: 4.5,
    reviewCount: 21,
    verified: true,
  },
  {
    name: 'GoodMerch',
    category: 'Мерч',
    city: 'Шымкент',
    ordersWithUs: 0,
    buyerScore: 4.1,
    reviewCount: 2,
    verified: false,
  },
];

export default function BuyerSuppliersPage() {
  return (
    <div>
      <Reveal className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold">Поставщики</h1>
          <p className="mt-2 text-sm text-muted">
            Компании, с которыми вы уже работали через QAJET. Повторите заказ в один клик.
          </p>
        </div>
        <Button variant="secondary">Запросить нового поставщика</Button>
      </Reveal>

      <Stagger
        startIndex={1}
        as="div"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {SUPPLIERS.map((s) => (
          <div key={s.name} className="rounded-card border border-rule bg-surface p-5">
            <div className="mb-3.5 flex items-start gap-3">
              <div className="h-11 w-11 shrink-0 rounded-control bg-page" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{s.name}</p>
                <p className="truncate text-fine text-muted">{s.category}</p>
              </div>
              <Stamp tone={s.verified ? 'progress' : 'neutral'} className="shrink-0">
                {s.verified ? 'Проверен' : 'Новый'}
              </Stamp>
            </div>
            <p className="mb-3 text-fine text-muted">
              {s.reviewCount < 3 ? (
                'Мало данных для оценки'
              ) : (
                <>
                  <span className="font-semibold text-ink">{s.buyerScore.toFixed(1)}</span> · оценка
                  покупателей на {s.reviewCount} заказах
                </>
              )}
            </p>
            <div className="flex justify-between border-rule border-t pt-3 text-fine text-muted">
              <span>
                {s.ordersWithUs === 0
                  ? 'Ещё не заказывали'
                  : `${s.ordersWithUs} ${pluralOrders(s.ordersWithUs)} с вами`}
              </span>
              <span>{s.city}</span>
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
  if (mod10 === 1 && mod100 !== 11) return 'заказ';
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'заказа';
  return 'заказов';
}
