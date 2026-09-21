import { BarGrow, Reveal } from '@qajet/ui/motion';
import Link from 'next/link';
import { CONTACTS } from './lib/contacts';

/**
 * Посадочная — отвечает на один вопрос: что это и зачем мне. Раньше заголовок
 * был абстрактным («Одна задача. Согласованный бюджет. Один закупочный партнёр.»),
 * а подзаголовок — на закупочном жаргоне («исполнимые варианты решения закупочной
 * задачи»); человеку со стороны было непонятно, что ему предлагают.
 *
 * Правила §13 и §17 в силе: никаких выдуманных цифр, отзывов и логотипов клиентов.
 * Демонстрационные варианты ниже помечены на странице как пример.
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
        color: 'purple' as const,
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
        color: 'purple' as const,
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

/** Реальная последовательность работы — нумерация здесь несёт порядок, а не украшает. */
const STEPS = [
  {
    title: 'Опишите задачу',
    text: 'Своими словами: что нужно, сколько, к какому сроку и в каком бюджете. Без форм на тридцать полей.',
  },
  {
    title: 'Мы собираем предложения',
    text: 'Рассылаем запросы проверенным поставщикам, уточняем условия и отсеиваем то, что не успеет или не подойдёт.',
  },
  {
    title: 'Вы выбираете вариант',
    text: 'Рекомендуемый, дешевле или с запасом по сроку. У каждого видно, из чего складывается цена и почему он такой.',
  },
  {
    title: 'Получаете заказ и документы',
    text: 'Мы ведём производство и доставку. Вы принимаете заказ и получаете закрывающие документы.',
  },
];

/** Только то, что продукт действительно делает, — без обещаний на вырост. */
const REASONS = [
  {
    title: 'Один договор и один счёт',
    text: 'Вместо пяти поставщиков у вас один подрядчик. Расчёты с исполнителями — наша забота.',
  },
  {
    title: 'Видно, почему дешевле',
    text: 'Сравниваем не прайсы, а итог: сроки, минимальные партии, доставку и налоговые последствия выбора поставщика.',
  },
  {
    title: 'Повторить — без повторного описания',
    text: 'Прошлая закупка сохраняется. Следующий такой же заказ не нужно объяснять заново.',
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-page">
      <header className="border-b border-rule bg-surface">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-6">
          <span className="text-sm font-extrabold tracking-wide">QAJET</span>
          <Link href="/login" className="text-fine text-muted hover:text-ink">
            Войти
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-16">
        <Reveal>
          <p className="text-micro font-semibold tracking-wide text-purple uppercase">
            Внешний отдел закупок для бизнеса
          </p>
          <h1 className="mt-3 max-w-2xl text-3xl font-extrabold text-balance text-ink sm:text-4xl">
            Скажите, что нужно купить. Остальное сделаем мы.
          </h1>
        </Reveal>
        <Reveal delay={0.05}>
          <p className="mt-4 max-w-xl text-base text-muted">
            Мерч, корпоративные подарки, welcome-наборы, полиграфия. Вы описываете задачу — QAJET
            находит поставщиков, сравнивает предложения и доводит заказ до закрывающих документов.
          </p>
        </Reveal>

        <Reveal delay={0.1} className="mt-8 flex flex-wrap gap-3">
          <a
            href={CONTACTS.whatsapp}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center justify-center rounded-control bg-purple px-5 text-sm font-semibold text-white hover:bg-purple/90"
          >
            Обсудить закупку
          </a>
          <Link
            href="/login"
            className="inline-flex h-11 items-center justify-center rounded-control border border-rule bg-surface px-5 text-sm font-semibold text-ink hover:bg-page"
          >
            Войти в систему →
          </Link>
        </Reveal>

        <section className="mt-16" aria-labelledby="example-heading">
          <h2 id="example-heading" className="text-lg font-bold text-ink">
            Как это выглядит
          </h2>
          <p className="mt-2 max-w-xl text-sm text-muted">Вы пишете одной фразой:</p>
          <p className="mt-3 max-w-xl rounded-card border border-rule bg-surface px-4 py-3 text-sm text-ink">
            «300 welcome-наборов до 20 октября, бюджет 3 млн ₸»
          </p>
          <p className="mt-6 max-w-xl text-sm text-muted">
            И получаете варианты, где видно, из чего складывается цена. Бывает, что вариант, дешёвый
            по предложению поставщика, в итоге обходится дороже — из-за налоговых последствий. Мы
            это считаем и показываем отдельно.
          </p>
          <div className="mt-8 space-y-8">
            {heroVariants.map((variant, i) => (
              <div key={variant.label}>
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <span className="text-fine text-muted">{variant.label}</span>
                  <span className="numeric text-sm">{variant.total}</span>
                </div>
                <BarGrow index={i} segments={variant.segments} />
              </div>
            ))}
          </div>
          <p className="mt-4 text-fine text-muted">
            Цифры демонстрационные — это пример экрана сравнения, а не реальная сделка.
          </p>
        </section>

        <section className="mt-16" aria-labelledby="how-heading">
          <h2 id="how-heading" className="text-lg font-bold text-ink">
            Как работаем
          </h2>
          <ol className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {STEPS.map((step, index) => (
              <li key={step.title} className="rounded-card border border-rule bg-surface p-5">
                <span className="numeric text-fine text-purple">{index + 1}</span>
                <p className="mt-1 text-sm font-bold text-ink">{step.title}</p>
                <p className="mt-1.5 text-fine text-muted">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-16" aria-labelledby="why-heading">
          <h2 id="why-heading" className="text-lg font-bold text-ink">
            Почему это проще, чем самим
          </h2>
          <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {REASONS.map((reason) => (
              <li key={reason.title}>
                <p className="text-sm font-bold text-ink">{reason.title}</p>
                <p className="mt-1.5 text-fine text-muted">{reason.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-16" aria-labelledby="who-heading">
          <h2 id="who-heading" className="text-lg font-bold text-ink">
            Для кого
          </h2>
          <p className="mt-3 max-w-xl text-sm text-muted">
            Для HR, маркетинга и офис-менеджеров — для тех, у кого закупки не основная работа и нет
            своего закупщика. Сейчас работаем в Алматы.
          </p>
        </section>

        <p className="mt-16 border-t border-rule pt-6 text-fine text-muted">
          Честный статус: сервис готовится к первым пилотным закупкам. Если вам подходит — напишите,
          и мы обсудим вашу задачу.
        </p>
      </main>

      <footer className="border-t border-rule bg-surface">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-5 gap-y-2 px-6 py-6 text-fine text-muted">
          <span>© QAJET</span>
          <Link href="/privacy" className="hover:text-ink">
            Политика конфиденциальности
          </Link>
          <Link href="/terms/suppliers" className="hover:text-ink">
            Условия для поставщиков
          </Link>
          <a href={CONTACTS.instagram} target="_blank" rel="noreferrer" className="hover:text-ink">
            Instagram
          </a>
        </div>
      </footer>
    </div>
  );
}
