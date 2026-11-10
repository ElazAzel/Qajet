import { BarGrow, Reveal } from '@qajet/ui/motion';
import {
  ArrowRight,
  Check,
  Eye,
  FileCheck2,
  Gift,
  PackageOpen,
  Repeat2,
  Shirt,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { DemoVideo } from './_landing/demo-video';
import { CONTACTS } from './lib/contacts';
import { LANDING_EXAMPLE_PHRASE } from './lib/landing-example';
import { PROGRAMS } from './lib/program-brief';

/**
 * Посадочная — отвечает на один вопрос: что это и зачем мне. Раньше заголовок
 * был абстрактным («Одна задача. Согласованный бюджет. Один закупочный партнёр.»),
 * а подзаголовок — на закупочном жаргоне («исполнимые варианты решения закупочной
 * задачи»); человеку со стороны было непонятно, что ему предлагают.
 *
 * Правила §13 и §17 в силе: никаких выдуманных цифр, отзывов и логотипов клиентов.
 * Демонстрационные варианты ниже помечены на странице как пример.
 *
 * Первый экран отвечает за три секунды: кто мы (заголовок), чем полезны (одна
 * строка и три пункта), что делать (одна кнопка) — и тут же сам продукт в
 * ролике. Шаги ниже показаны настоящими экранами на демо-данных, а не макетами.
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

/**
 * Реальная последовательность работы — нумерация несёт порядок. У каждого шага
 * настоящий экран продукта; сравнение (шаг 3) — демонстрационное и так подписано.
 */
const STEPS: {
  title: string;
  text: string;
  visual: ReactNode;
}[] = [
  {
    title: 'Опишите задачу одной фразой',
    text: 'Что, сколько, к какому сроку и в каком бюджете. Форма сама разберёт текст на позицию, количество, срок и бюджет — вы только проверяете.',
    visual: (
      <img
        src="/landing/step-describe.webp"
        width={940}
        height={728}
        loading="lazy"
        decoding="async"
        alt="Экран заявки: в поле «Что нужно закупить?» фраза про 150 welcome-наборов, ниже — что система поняла: позиция, количество, срок и бюджет"
        className="h-auto w-full rounded-card border border-rule bg-surface shadow-xl shadow-ink/5"
      />
    ),
  },
  {
    title: 'Мы собираем предложения',
    text: 'Рассылаем запрос проверенным поставщикам, уточняем условия и отсеиваем тех, кто не успеет или не подойдёт. Вы видите, чей сейчас ход и к какой дате ждать.',
    visual: (
      <img
        src="/landing/step-status.webp"
        width={1408}
        height={586}
        loading="lazy"
        decoding="async"
        alt="Экран заказа: статус «Подбираем исполнителей», сейчас ход за QAJET, ожидаемая дата"
        className="h-auto w-full rounded-card border border-rule bg-surface shadow-xl shadow-ink/5"
      />
    ),
  },
  {
    title: 'Вы выбираете вариант',
    text: 'Рекомендуемый, дешевле или с запасом по сроку. Видно, из чего складывается цена: вариант, дешёвый по предложению поставщика, бывает дороже в итоге — из-за налогов. Мы это считаем.',
    visual: (
      <div className="rounded-card border border-rule bg-surface p-5 shadow-xl shadow-ink/5 sm:p-6">
        <div className="space-y-6">
          {heroVariants.map((variant, i) => (
            <div key={variant.label}>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <span className="text-fine text-muted">{variant.label}</span>
                <span className="numeric text-sm font-semibold">{variant.total}</span>
              </div>
              <BarGrow index={i} segments={variant.segments} />
            </div>
          ))}
        </div>
        <p className="mt-4 text-micro text-muted">
          Пример экрана сравнения: цифры демонстрационные, не реальная сделка.
        </p>
      </div>
    ),
  },
  {
    title: 'Получаете заказ и документы',
    text: 'Мы ведём производство и доставку. Вы принимаете заказ, разница с предоплатой возвращается или доплачивается, закрывающие документы — в одном месте.',
    visual: (
      <img
        src="/landing/step-documents.webp"
        width={1408}
        height={586}
        loading="lazy"
        decoding="async"
        alt="Закрытый заказ: итоговая стоимость, возврат разницы покупателю и «Документы заказа» — счёт и акт"
        className="h-auto w-full rounded-card border border-rule bg-surface shadow-xl shadow-ink/5"
      />
    ),
  },
];

/** Только то, что продукт действительно делает, — без обещаний на вырост. */
const REASONS = [
  {
    icon: <FileCheck2 size={20} aria-hidden="true" />,
    title: 'Один договор и один счёт',
    text: 'Вместо пяти поставщиков у вас один подрядчик. Расчёты с исполнителями — наша забота.',
  },
  {
    icon: <Eye size={20} aria-hidden="true" />,
    title: 'Видно, почему дешевле',
    text: 'Сравниваем не прайсы, а итог: сроки, минимальные партии, доставку и налоговые последствия выбора поставщика.',
  },
  {
    icon: <Repeat2 size={20} aria-hidden="true" />,
    title: 'Повторить — без повторного описания',
    text: 'Прошлая закупка сохраняется. Следующий такой же заказ не нужно объяснять заново.',
  },
];

const HERO_POINTS = ['Один договор и один счёт', 'Видно, почему дешевле', 'Повтор в один шаг'];

function PrimaryCta({ className = '' }: { className?: string }) {
  return (
    <Link
      href="/collections"
      className={`inline-flex h-12 items-center justify-center gap-2 rounded-control bg-lime px-6 text-sm font-bold text-ink transition-transform duration-[var(--duration-quick)] hover:-translate-y-0.5 ${className}`}
    >
      Собрать закупку <ArrowRight size={16} aria-hidden="true" />
    </Link>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-page text-ink">
      {/* Первый экран: тёмный, как ролик, — кто мы, чем полезны, что делать. */}
      <section className="relative overflow-hidden bg-ink text-white">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:22px_22px]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-48 right-[-15%] h-[560px] w-[560px] rounded-full bg-purple/35 blur-[120px]"
        />
        <header className="relative mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <span className="text-base font-extrabold tracking-wide">QAJET</span>
          <nav
            aria-label="Разделы страницы"
            className="hidden gap-7 text-fine text-white/70 md:flex"
          >
            <a href="#collections" className="hover:text-white">
              Готовые сценарии
            </a>
            <a href="#how" className="hover:text-white">
              Как это работает
            </a>
            <a href="#why" className="hover:text-white">
              Почему проще
            </a>
            <a href="#who" className="hover:text-white">
              Для кого
            </a>
          </nav>
          <Link href="/login" className="text-fine font-semibold text-white/80 hover:text-white">
            Войти
          </Link>
        </header>

        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 pt-6 pb-16 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:pt-12 lg:pb-24">
          <div>
            <Reveal>
              <p className="text-micro font-semibold tracking-[0.14em] text-lime uppercase">
                Внешний отдел закупок для бизнеса
              </p>
              <h1 className="mt-4 text-4xl leading-[1.05] font-extrabold tracking-tight text-balance sm:text-5xl lg:text-6xl">
                Мерч и наборы <span className="text-lime">под ваш бюджет и дату.</span>
              </h1>
            </Reveal>
            <Reveal delay={0.05}>
              <p className="mt-5 max-w-xl text-base text-white/75 sm:text-lg">
                Выберите повод и составьте бриф. QAJET подберёт поставщиков, согласует полную
                стоимость и проведёт закупку до приёмки и документов.
              </p>
            </Reveal>
            <Reveal delay={0.1} className="mt-7 flex flex-wrap items-center gap-3">
              <PrimaryCta />
              <a
                href={CONTACTS.whatsapp}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-12 items-center justify-center rounded-control border border-white/20 px-5 text-sm font-semibold text-white hover:bg-white/10"
              >
                Обсудить задачу
              </a>
            </Reveal>
            <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-fine text-white/80">
              {HERO_POINTS.map((point) => (
                <li key={point} className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-lime text-ink">
                    <Check size={13} strokeWidth={3} aria-hidden="true" />
                  </span>
                  {point}
                </li>
              ))}
            </ul>
          </div>
          <Reveal delay={0.12}>
            <DemoVideo />
          </Reveal>
        </div>
      </section>

      <main>
        <section
          id="collections"
          aria-labelledby="collections-heading"
          className="mx-auto max-w-6xl scroll-mt-8 px-5 pt-16 sm:px-8 sm:pt-20"
        >
          <p className="text-fine font-semibold text-purple">Начните с повода</p>
          <h2
            id="collections-heading"
            className="mt-3 max-w-3xl text-3xl font-extrabold tracking-tight text-balance sm:text-4xl"
          >
            Готовая основа для вашей закупки
          </h2>
          <p className="mt-4 max-w-2xl text-base text-muted">
            Укажите количество, бюджет и дату. Получите состав для согласования, который можно
            обсудить с консьержем или перенести в заявку.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {PROGRAMS.map((program) => {
              const Icon =
                program.id === 'welcome' ? PackageOpen : program.id === 'event' ? Shirt : Gift;
              return (
                <Link
                  key={program.id}
                  href={`/collections?program=${program.id}`}
                  className="group flex flex-col rounded-card border border-rule bg-surface p-6 transition-colors hover:border-purple focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-purple"
                >
                  <Icon className="text-purple" size={32} aria-hidden="true" />
                  <p className="mt-5 text-fine text-muted">{program.occasion}</p>
                  <h3 className="mt-2 text-xl font-bold">{program.title}</h3>
                  <p className="mt-3 text-sm text-muted">{program.description}</p>
                  <span className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-purple">
                    Подготовить бриф <ArrowRight size={16} aria-hidden="true" />
                  </span>
                </Link>
              );
            })}
          </div>
          <p className="mt-4 text-fine text-muted">
            Сценарии помогают описать задачу. Наличие, стоимость и срок подтвердим перед
            согласованием заказа.
          </p>
        </section>
        {/* Одна фраза — главный жест продукта, крупно, до шагов. */}
        <section
          className="mx-auto max-w-6xl px-5 pt-16 sm:px-8 sm:pt-20"
          aria-labelledby="phrase-heading"
        >
          <h2
            id="phrase-heading"
            className="text-micro font-semibold tracking-[0.14em] text-purple uppercase"
          >
            Вы пишете одной фразой
          </h2>
          <p className="mt-4 max-w-3xl text-2xl leading-snug font-bold text-balance text-ink sm:text-3xl">
            «{LANDING_EXAMPLE_PHRASE}»
          </p>
          <p className="mt-3 max-w-2xl text-sm text-muted">
            И всё. Остальное — поставщиков, сравнение, оплату, доставку и документы — ведёт QAJET.
          </p>
        </section>

        <section
          id="how"
          className="mx-auto max-w-6xl scroll-mt-8 px-5 pt-16 sm:px-8 sm:pt-24"
          aria-labelledby="how-heading"
        >
          <h2
            id="how-heading"
            className="text-3xl font-extrabold tracking-tight text-ink sm:text-4xl"
          >
            Как это работает
          </h2>
          <ol aria-label="Как это работает" className="mt-10 flex flex-col gap-14 sm:gap-20">
            {STEPS.map((step, index) => (
              <li key={step.title} className="grid items-center gap-6 lg:grid-cols-2 lg:gap-14">
                <div className={index % 2 === 1 ? 'lg:order-2' : undefined}>
                  <span className="numeric flex h-9 w-9 items-center justify-center rounded-full bg-ink text-sm font-bold text-lime">
                    {index + 1}
                  </span>
                  <h3 className="mt-4 text-xl font-bold text-ink sm:text-2xl">{step.title}</h3>
                  <p className="mt-2 max-w-md text-sm text-muted sm:text-base">{step.text}</p>
                </div>
                <div className={index % 2 === 1 ? 'lg:order-1' : undefined}>{step.visual}</div>
              </li>
            ))}
          </ol>
        </section>

        <section
          id="why"
          className="mx-auto max-w-6xl scroll-mt-8 px-5 pt-20 sm:px-8 sm:pt-28"
          aria-labelledby="why-heading"
        >
          <h2
            id="why-heading"
            className="text-3xl font-extrabold tracking-tight text-ink sm:text-4xl"
          >
            Почему это проще, чем самим
          </h2>
          <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {REASONS.map((reason) => (
              <li key={reason.title} className="rounded-card border border-rule bg-surface p-6">
                <span className="flex h-10 w-10 items-center justify-center rounded-control bg-purple-10 text-purple">
                  {reason.icon}
                </span>
                <p className="mt-4 text-base font-bold text-ink">{reason.title}</p>
                <p className="mt-1.5 text-sm text-muted">{reason.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section
          id="who"
          className="mx-auto max-w-6xl scroll-mt-8 px-5 pt-20 sm:px-8 sm:pt-28"
          aria-labelledby="who-heading"
        >
          <h2
            id="who-heading"
            className="text-3xl font-extrabold tracking-tight text-ink sm:text-4xl"
          >
            Для кого
          </h2>
          <p className="mt-4 max-w-2xl text-base text-muted">
            Для HR, маркетинга и офис-менеджеров — для тех, у кого закупки не основная работа и нет
            своего закупщика. Сейчас работаем в Алматы.
          </p>
        </section>

        {/* Финальный призыв — тот же, что наверху: одна кнопка на всю страницу. */}
        <section
          className="mx-auto max-w-6xl px-5 pt-20 pb-16 sm:px-8 sm:pt-28 sm:pb-24"
          aria-labelledby="cta-heading"
        >
          <div className="relative overflow-hidden rounded-hero bg-ink px-6 py-12 text-white sm:px-12 sm:py-16">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-40 -left-24 h-[420px] w-[420px] rounded-full bg-purple/30 blur-[110px]"
            />
            <h2
              id="cta-heading"
              className="relative max-w-2xl text-3xl font-extrabold tracking-tight text-balance sm:text-4xl"
            >
              Опишите задачу — мы вернёмся с вариантами.
            </h2>
            <p className="relative mt-3 max-w-xl text-white/75">
              Честный статус: сервис готовится к первым пилотным закупкам. Если вам подходит —
              напишите, и мы обсудим вашу задачу.
            </p>
            <PrimaryCta className="relative mt-7" />
          </div>
        </section>
      </main>

      <footer className="border-t border-rule bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-5 py-6 text-fine text-muted sm:px-8">
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
