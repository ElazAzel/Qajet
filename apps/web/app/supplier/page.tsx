import { Reveal, Stagger, Stamp } from '@qajet/ui/motion';
import { Button, Money } from '@qajet/ui/primitives';

/**
 * Дашборд поставщика — §10 «Поставщик»: входящие RFQ с дедлайном ответа,
 * двухступенчатый ответ («берусь / не берусь» первым шагом), активные
 * заказы. Мобильный сценарий первичен — оболочка уже даёт нижние табы,
 * здесь контент одной колонкой, читаемой с телефона.
 */

interface StatTile {
  value: string;
  amountKzt?: number;
  title: string;
  note: string;
}

const STATS: StatTile[] = [
  { value: '3', title: 'Новых RFQ', note: 'Требуют ответа' },
  { value: '5', title: 'Заказов в работе', note: '+2 за неделю' },
  { amountKzt: 4_200_000, value: '', title: 'Выручка за месяц', note: '+18% к прошлому' },
  { value: '4,9', title: 'Оценка покупателей', note: '128 заказов' },
];

interface RfqRow {
  title: string;
  buyer: string;
  qty: string;
  respondBy: string;
  exploration?: boolean;
}

const RFQS: RfqRow[] = [
  {
    title: 'Брендированные термокружки',
    buyer: 'ТОО «Nomad Tech»',
    qty: '200 шт',
    respondBy: '14 сен',
  },
  { title: 'Худи с вышивкой логотипа', buyer: 'ACME Corp.', qty: '80 шт', respondBy: '15 сен' },
  {
    title: 'Набор стикеров и блокнотов',
    buyer: 'Beeline Events',
    qty: '500 шт',
    respondBy: '16 сен',
    exploration: true,
  },
];

interface OrderRow {
  name: string;
  buyer: string;
  eta: string;
  status: string;
  tone: 'neutral' | 'progress' | 'signal';
}

const ORDERS: OrderRow[] = [
  {
    name: 'Термокружки',
    buyer: 'Nomad Tech',
    eta: '20 сен',
    status: 'В производстве',
    tone: 'progress',
  },
  {
    name: 'Футболки с принтом',
    buyer: 'ACME Corp.',
    eta: '25 сен',
    status: 'План утверждён',
    tone: 'neutral',
  },
  {
    name: 'Блокноты А5',
    buyer: 'Beeline Events',
    eta: '22 сен',
    status: 'В производстве',
    tone: 'progress',
  },
  {
    name: 'Эко-шопперы',
    buyer: 'Nomad Tech',
    eta: '30 сен',
    status: 'Ждём материалы',
    tone: 'signal',
  },
];

export default function SupplierHome() {
  return (
    <div className="flex flex-col gap-6 px-4 py-5 sm:px-6 sm:py-6">
      <Reveal>
        <h1 className="text-2xl font-extrabold">Здравствуйте, Uka Print</h1>
        <p className="mt-1.5 text-fine text-muted">У вас 3 новых RFQ и 5 заказов в работе.</p>
      </Reveal>

      <Stagger startIndex={1} as="div" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {STATS.map((s) => (
          <div key={s.title} className="rounded-card border border-rule bg-surface p-4">
            {s.amountKzt !== undefined ? (
              <Money amountKzt={s.amountKzt} className="text-xl font-semibold" />
            ) : (
              <p className="numeric text-xl font-semibold">{s.value}</p>
            )}
            <p className="mt-1 text-fine font-semibold">{s.title}</p>
            <p className="mt-0.5 text-micro text-muted">{s.note}</p>
          </div>
        ))}
      </Stagger>

      <Reveal delay={0.12} className="rounded-card border border-rule bg-surface">
        <div className="flex items-center justify-between border-rule border-b p-5">
          <h3 className="text-base font-bold">Новые RFQ — быстрый ответ</h3>
          <span className="text-fine font-semibold text-muted">Все заявки →</span>
        </div>
        <ul>
          {RFQS.map((r) => (
            <li
              key={r.title}
              className="flex flex-col gap-3 border-rule border-b px-5 py-4 last:border-b-0 sm:flex-row sm:items-center"
            >
              <div className="h-10 w-10 shrink-0 rounded-control bg-page" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  {r.title}
                  {r.exploration && (
                    <span className="text-micro font-normal text-muted">· пробное приглашение</span>
                  )}
                </p>
                <p className="text-fine text-muted">
                  {r.buyer} · {r.qty}
                </p>
              </div>
              <p className="text-fine font-semibold text-signal sm:whitespace-nowrap">
                Ответить до {r.respondBy}
              </p>
              <div className="flex gap-2 sm:shrink-0">
                <Button variant="secondary" size="sm">
                  Не берусь
                </Button>
                <Button variant="primary" size="sm">
                  Берусь, цена и срок
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Reveal>

      <Reveal delay={0.18} className="rounded-card border border-rule bg-surface p-5">
        <h3 className="mb-4 text-base font-bold">Заказы в производстве</h3>
        <ul className="flex flex-col gap-3.5">
          {ORDERS.map((o) => (
            <li key={o.name} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-fine font-semibold">
                  {o.name} — {o.buyer}
                </p>
                <p className="text-micro text-muted">ETA {o.eta}</p>
              </div>
              <Stamp tone={o.tone} className="shrink-0">
                {o.status}
              </Stamp>
            </li>
          ))}
        </ul>
      </Reveal>

      <p className="text-fine text-muted">
        Выручка и рейтинг за месяц — сводка. Полная разбивка (доля вовремя, доля без споров, N
        заказов) на странице «Рост».
      </p>
    </div>
  );
}
