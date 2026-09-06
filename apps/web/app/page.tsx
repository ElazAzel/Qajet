import { BarGrow, Reveal } from '@qajet/ui/motion';
import Link from 'next/link';

/**
 * Лендинг — §13: герой не большая цифра с градиентом, а живая полоса
 * варианта. Полный лендинг (сравнение двух реальных корзин, «как это
 * работает», честный статус) — фаза 6. Здесь — реальный, но минимальный
 * маршрут фазы 0: заголовок, полоса как демонстрация фирменного элемента,
 * вход в три роли и на страницу входа. Никаких выдуманных цифр (§13, §17).
 */

const heroVariants = [
  {
    label: 'Рекомендованный',
    total: '1 180 000 ₸',
    segments: [
      {
        key: 'goods',
        label: 'Товар',
        fraction: 0.58,
        color: 'ink' as const,
        amountLabel: '684 000 ₸',
      },
      {
        key: 'work',
        label: 'Нанесение и работы',
        fraction: 0.18,
        color: 'muted' as const,
        amountLabel: '212 000 ₸',
      },
      {
        key: 'delivery',
        label: 'Доставка',
        fraction: 0.06,
        color: 'muted' as const,
        amountLabel: '68 000 ₸',
      },
      {
        key: 'commission',
        label: 'Комиссия QAJET',
        fraction: 0.12,
        color: 'accent' as const,
        amountLabel: '142 000 ₸',
      },
      {
        key: 'tax',
        label: 'Налоговый эффект',
        fraction: 0.06,
        color: 'signal' as const,
        amountLabel: '74 000 ₸',
      },
    ],
  },
  {
    label: 'Дешевле по КП, дороже по факту',
    total: '1 240 000 ₸',
    segments: [
      {
        key: 'goods',
        label: 'Товар',
        fraction: 0.52,
        color: 'ink' as const,
        amountLabel: '645 000 ₸',
      },
      {
        key: 'work',
        label: 'Нанесение и работы',
        fraction: 0.16,
        color: 'muted' as const,
        amountLabel: '198 000 ₸',
      },
      {
        key: 'delivery',
        label: 'Доставка',
        fraction: 0.08,
        color: 'muted' as const,
        amountLabel: '99 000 ₸',
      },
      {
        key: 'commission',
        label: 'Комиссия QAJET',
        fraction: 0.1,
        color: 'accent' as const,
        amountLabel: '124 000 ₸',
      },
      {
        key: 'tax',
        label: 'Налоговый эффект',
        fraction: 0.14,
        color: 'signal' as const,
        amountLabel: '174 000 ₸',
      },
    ],
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-rule">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-6">
          <span className="text-sm font-medium tracking-wide">QAJET</span>
          <Link href="/login" className="text-fine text-muted hover:text-ink">
            Войти
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-16">
        <Reveal>
          <h1 className="max-w-xl text-3xl font-medium text-ink">
            Одна задача. Согласованный бюджет. Один закупочный партнёр.
          </h1>
        </Reveal>
        <Reveal delay={0.05}>
          <p className="mt-4 max-w-lg text-sm text-muted">
            QAJET сравнивает не отдельные строки прайса, а целые исполнимые варианты решения
            закупочной задачи: мерч, корпоративные наборы, полиграфия.
          </p>
        </Reveal>

        <div className="mt-12 space-y-8">
          {heroVariants.map((variant, i) => (
            <div key={variant.label}>
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-fine text-muted">{variant.label}</span>
                <span className="numeric text-sm">{variant.total}</span>
              </div>
              <BarGrow index={i} segments={variant.segments} />
            </div>
          ))}
        </div>

        <Reveal delay={0.1} className="mt-10 flex gap-3">
          <Link
            href="/login"
            className="inline-flex h-10 items-center justify-center rounded-[var(--radius-control)] bg-accent px-4 text-sm font-medium text-ink hover:bg-accent/90"
          >
            Войти в систему
          </Link>
        </Reveal>

        <Reveal delay={0.15} className="mt-16 border-t border-rule pt-6">
          <p className="text-fine text-muted">
            Честный статус: платформа в разработке. Пример выше — иллюстрация фирменного экрана
            сравнения на демонстрационных цифрах, не реальная сделка.
          </p>
        </Reveal>
      </main>
    </div>
  );
}
