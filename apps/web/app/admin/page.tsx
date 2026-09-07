import { Reveal, Stagger, Stamp, type StampTone } from '@qajet/ui/motion';
import { Money } from '@qajet/ui/primitives';

/**
 * Обзор платформы / верификация поставщиков — §10 «Админ». Первый пункт
 * раздела: «Верификация и комплаенс поставщиков» — companies.verified_at,
 * verification_note (agents.md §5). Настройка комиссии, финансовая сверка
 * и «Как система учится» — отдельные разделы того же меню (см. layout).
 */

interface StatTile {
  value?: string;
  amountKzt?: number;
  title: string;
  note: string;
}

const STATS: StatTile[] = [
  { value: '1 284', title: 'Пользователей', note: '+64 за месяц' },
  { value: '312', title: 'Поставщиков', note: '+12 за месяц' },
  { amountKzt: 186_000_000, title: 'Оборот за месяц', note: '+9% к прошлому' },
  { value: '4', title: 'На верификации', note: 'Требуют проверки' },
];

interface VendorRow {
  name: string;
  category: string;
  city: string;
  submittedAt: string;
  status: string;
  tone: StampTone;
}

const VENDORS: VendorRow[] = [
  {
    name: 'Alma Design',
    category: 'Подарки',
    city: 'Алматы',
    submittedAt: '5 сен',
    status: 'На проверке',
    tone: 'neutral',
  },
  {
    name: 'PrintHub',
    category: 'Полиграфия',
    city: 'Астана',
    submittedAt: '4 сен',
    status: 'На проверке',
    tone: 'neutral',
  },
  {
    name: 'MebelPro',
    category: 'Офисная мебель',
    city: 'Шымкент',
    submittedAt: '3 сен',
    status: 'Одобрен',
    tone: 'progress',
  },
  {
    name: 'GiftBox KZ',
    category: 'Подарки',
    city: 'Алматы',
    submittedAt: '1 сен',
    status: 'Отклонён',
    tone: 'signal',
  },
];

interface UserRow {
  name: string;
  company: string;
  role: string;
}

const USERS: UserRow[] = [
  { name: 'Ильяс Ахметов', company: 'ACME Corp.', role: 'Покупатель' },
  { name: 'Uka Print', company: 'Поставщик', role: 'Поставщик' },
  { name: 'Динара Есенова', company: 'QAJET', role: 'Консьерж' },
  { name: 'ТОО «Nomad Tech»', company: 'Nomad Tech', role: 'Покупатель' },
];

interface PayoutRow {
  order: string;
  supplier: string;
  amountKzt: number;
}

const PAYOUTS: PayoutRow[] = [
  { order: 'Мерч для конференции', supplier: 'Uka Print', amountKzt: 1_240_000 },
  { order: 'Welcome Pack', supplier: 'PrintLab', amountKzt: 860_000 },
  { order: 'HR-подарки к Наурызу', supplier: 'Eventoria', amountKzt: 430_000 },
  { order: 'Офисная мебель', supplier: 'MebelPro', amountKzt: 3_100_000 },
];

export default function AdminHome() {
  return (
    <div className="flex flex-col gap-6">
      <Reveal>
        <h1 className="text-2xl font-extrabold">Верификация поставщиков</h1>
        <p className="mt-1.5 text-fine text-muted">
          Комплаенс и статус проверки — компании появляются в очереди сразу после регистрации.
        </p>
      </Reveal>

      <Stagger startIndex={1} as="div" className="grid grid-cols-2 gap-4 sm:grid-cols-4">
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

      <Reveal delay={0.12} className="rounded-card border border-rule bg-surface p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold">Очередь на верификацию</h3>
          <span className="text-fine font-semibold text-muted">Все поставщики →</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-fine">
            <thead>
              <tr className="border-rule border-b text-micro text-muted uppercase tracking-wide">
                <th className="px-2 py-2.5 text-left font-semibold">Поставщик</th>
                <th className="px-2 py-2.5 text-left font-semibold">Категория</th>
                <th className="px-2 py-2.5 text-left font-semibold">Город</th>
                <th className="px-2 py-2.5 text-left font-semibold">Подан</th>
                <th className="px-2 py-2.5 text-left font-semibold">Статус</th>
              </tr>
            </thead>
            <tbody>
              {VENDORS.map((v) => (
                <tr key={v.name} className="border-rule border-b last:border-b-0">
                  <td className="px-2 py-3 font-semibold">{v.name}</td>
                  <td className="px-2 py-3 text-muted">{v.category}</td>
                  <td className="px-2 py-3 text-muted">{v.city}</td>
                  <td className="px-2 py-3 text-muted">{v.submittedAt}</td>
                  <td className="px-2 py-3">
                    <Stamp tone={v.tone}>{v.status}</Stamp>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Reveal delay={0.18} className="rounded-card border border-rule bg-surface p-6">
          <h3 className="mb-4 text-base font-bold">Последние пользователи</h3>
          <ul className="flex flex-col gap-3.5">
            {USERS.map((u) => (
              <li key={u.name} className="flex items-center gap-3">
                <div className="h-9 w-9 shrink-0 rounded-full bg-page" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-fine font-semibold">{u.name}</p>
                  <p className="truncate text-micro text-muted">{u.company}</p>
                </div>
                <span className="shrink-0 text-micro font-semibold text-muted">{u.role}</span>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={0.22} className="rounded-card border border-rule bg-surface p-6">
          <h3 className="mb-4 text-base font-bold">Последние выплаты поставщикам</h3>
          <ul className="flex flex-col gap-3.5">
            {PAYOUTS.map((p) => (
              <li key={p.order} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-fine font-semibold">{p.order}</p>
                  <p className="truncate text-micro text-muted">{p.supplier}</p>
                </div>
                <Money amountKzt={p.amountKzt} className="shrink-0 text-fine font-semibold" />
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </div>
  );
}
