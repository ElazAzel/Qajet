import { COMMISSION_DEFAULT_PCT } from '@qajet/engine/commission';
import { cn } from '@qajet/ui/lib/cn';
import { Reveal, ScrollReveal, Stagger } from '@qajet/ui/motion';
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  Gift,
  Link as LinkIcon,
  ListChecks,
  Megaphone,
  MessageCircle,
  Package,
  TrendingUp,
  Users,
} from 'lucide-react';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import styles from './startupbattle.module.css';
import { Comparison, Header, IntCountUp, MoneyCountUp, ProductTour } from './startupbattle-client';

const description =
  'QAJET — внешний отдел закупок для бизнеса. Один запрос, согласованный бюджет и сопровождение от выбора поставщиков до принятого заказа. Алматы, Казахстан.';

export const metadata: Metadata = {
  title: 'Закупки не должны отвлекать от бизнеса',
  description,
  openGraph: {
    title: 'QAJET — закупки не должны отвлекать от бизнеса',
    description,
    type: 'website',
    locale: 'ru_RU',
    siteName: 'QAJET',
  },
  twitter: { card: 'summary_large_image', title: 'QAJET — внешний отдел закупок', description },
};

const contact = 'https://www.instagram.com/qajet.io/';
const whatsapp = 'https://wa.me/77000204791';
const linkedin = 'https://www.linkedin.com/in/elazart?utm_source=vizitkastartup';
/**
 * Презентация больше не лежит в репозитории. 24 МБ составляли 98,6% всего
 * public/, Next копировал их в standalone при КАЖДОЙ сборке, и на Windows это
 * приводило к `EBUSY`: антивирус держал свежую копию, и сборка падала.
 *
 * Адрес задаётся NEXT_PUBLIC_PITCH_PDF_URL. Пока переменная не задана, кнопки
 * скачивания нет — вместо неё честная строка. Битая ссылка хуже отсутствующей:
 * по ней человек уходит на 404 и считает, что сломан весь сайт.
 */
const pitch = process.env.NEXT_PUBLIC_PITCH_PDF_URL ?? null;

export default function StartupBattlePage() {
  return (
    <div className={styles.page}>
      <a className={styles.skip} href="#main">
        Перейти к содержимому
      </a>
      <Header />

      <main id="main" className={styles.main}>
        <section className={styles.hero} aria-labelledby="hero-title">
          <Stagger className={cn(styles.heroCopy)}>
            <Reveal className={cn(styles.eyebrow)}>
              <span className={styles.dot} /> Алматы, Казахстан{' '}
              <span className={styles.eyebrowDivider}>/</span> Pizza Pitch
            </Reveal>
            <Reveal>
              <h1 id="hero-title">
                <span>Закупки</span> не должны отвлекать от бизнеса.
              </h1>
            </Reveal>
            <Reveal>
              <p className={styles.heroDescription}>
                Ваш внешний отдел закупок. От первого «нам нужно» до принятого заказа — с одним
                ответственным партнёром.
              </p>
            </Reveal>
            <Reveal className={cn(styles.heroActions)}>
              <a href="#product" className={`${styles.button} ${styles.limeButton}`}>
                Посмотреть продукт <ArrowDown size={17} aria-hidden="true" />
              </a>
              {pitch && (
                <a href={pitch} target="_blank" rel="noreferrer" className={styles.deckLink}>
                  Питч-дек <ArrowUpRight size={16} aria-hidden="true" />
                  <span className={styles.srOnly}> (PDF, новая вкладка)</span>
                </a>
              )}
            </Reveal>
            <Reveal>
              <p className={styles.heroFoot}>
                Одна задача. Согласованный бюджет.
                <br />
                Один закупочный партнёр.
              </p>
            </Reveal>
          </Stagger>
          <Reveal from="right" delay={0.12} className={cn(styles.heroDemo)}>
            <Comparison />
            <p className={styles.demoCaption}>
              Сравниваем весь заказ: товар, работы, доставку и комиссию.
            </p>
          </Reveal>
        </section>

        <div className={styles.audience}>
          <ScrollReveal className={cn(styles.audienceIntro)}>
            Для команд, у которых
            <br />
            <strong>закупки повторяются</strong>
          </ScrollReveal>
          <ScrollReveal delay={0.06}>
            <Users size={21} aria-hidden="true" />
            <span>
              <strong>HR</strong>
              <small>Welcome-наборы и подарки</small>
            </span>
          </ScrollReveal>
          <ScrollReveal delay={0.12}>
            <Megaphone size={21} aria-hidden="true" />
            <span>
              <strong>Маркетинг</strong>
              <small>Мерч и полиграфия</small>
            </span>
          </ScrollReveal>
          <ScrollReveal delay={0.18}>
            <Gift size={21} aria-hidden="true" />
            <span>
              <strong>Мероприятия</strong>
              <small>Бейджи и материалы</small>
            </span>
          </ScrollReveal>
        </div>

        <section id="how-it-works" className={styles.section} aria-labelledby="process-title">
          <ScrollReveal className={cn(styles.sectionHeading)}>
            <div>
              <p className={styles.kicker}>От задачи к результату</p>
              <h2 id="process-title">
                Вы готовите мероприятие.
                <br />
                <span>А не становитесь закупщиком.</span>
              </h2>
            </div>
            <p>
              Поиск в чатах, несопоставимые КП, таблицы и звонки поставщикам. QAJET собирает эту
              работу в один управляемый процесс.
            </p>
          </ScrollReveal>
          <ScrollReveal delay={0.08}>
            <ol className={styles.steps}>
              {[
                [
                  '01',
                  'Расскажите, что нужно',
                  'Задача, бюджет и дата. Мерч для команды, подарки клиентам или материалы для события.',
                  'Один запрос',
                ],
                [
                  '02',
                  'Выберите целый вариант',
                  'Уточняем задачу, подбираем поставщиков и сравниваем полную стоимость с учётом сроков.',
                  'Согласованный бюджет',
                ],
                [
                  '03',
                  'Примите готовый заказ',
                  'Координируем производство и доставку, ведём согласования и закрывающие документы.',
                  'Один ответственный партнёр',
                ],
              ].map(([number, title, body, result]) => (
                <li key={number} className={styles.stepCard}>
                  <span className={styles.stepNumber}>{number}</span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                  <span className={styles.stepResult}>
                    <Check size={15} aria-hidden="true" />
                    {result}
                  </span>
                </li>
              ))}
            </ol>
          </ScrollReveal>
          <ScrollReveal delay={0.14} className={cn(styles.distinction)}>
            <Package size={22} aria-hidden="true" />
            <p>
              <strong>Ценность — в исполнении всей задачи.</strong> Подбор поставщиков, сопоставимые
              предложения и персональное сопровождение в одном месте.
            </p>
          </ScrollReveal>
        </section>

        <section
          id="product"
          className={`${styles.section} ${styles.productSection}`}
          aria-labelledby="product-title"
        >
          <ScrollReveal className={cn(styles.sectionHeading)}>
            <div>
              <p className={styles.kicker}>Внутри QAJET</p>
              <h2 id="product-title">
                Один процесс.
                <br />
                <span>У каждого — свой рабочий экран.</span>
              </h2>
            </div>
            <p>
              Покупатель принимает решения. Консьерж ведёт закупку. Поставщик отвечает на запросы.
              Администратор контролирует платформу.
            </p>
          </ScrollReveal>
          <ScrollReveal delay={0.08}>
            <ProductTour />
          </ScrollReveal>
          <div className={styles.productBottom}>
            <p>
              <span className={styles.statusDot} /> Веб-MVP готовится к пилотам · На экранах
              демонстрационные данные
            </p>
            <Link href="/login">
              Открыть платформу <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </section>

        <section id="technology" className={styles.section} aria-labelledby="technology-title">
          <ScrollReveal className={cn(styles.sectionHeading)}>
            <div>
              <p className={styles.kicker}>Технология внутри</p>
              <h2 id="technology-title">
                Не чат-бот.
                <br />
                <span>Объяснимый подбор поставщиков.</span>
              </h2>
            </div>
            <p>
              Смысл технологии — снизить трудозатраты на закупку и обоснованно выбрать
              исполнимый вариант. Решения проверяются по данным, а не генерируются из воздуха.
            </p>
          </ScrollReveal>
          <div className={styles.engineGrid}>
            {[
              {
                step: '01',
                heading: 'Проверяем ограничения',
                body: 'Категория, доступные технологии, тираж, город и сроки. Неподходящие исполнители не попадают в короткий список.',
              },
              {
                step: '02',
                heading: 'Ранжируем предложения',
                body: 'Подбор учитывает историю ответов, соблюдение сроков и загрузку. Причину выбора можно объяснить.',
              },
              {
                step: '03',
                heading: 'Улучшаем по результатам',
                body: 'Механизм обновляет веса подбора и прогноз сроков после закрытых заказов. Сравниваем стоимость всей закупки.',
              },
            ].map(({ step, heading, body }) => (
              <ScrollReveal key={step} className={cn(styles.engineCard)}>
                <span>{step}</span>
                <h3>{heading}</h3>
                <p>{body}</p>
              </ScrollReveal>
            ))}
          </div>
          <p className={styles.sourceNote}>
            Алгоритмы и контур обучения реализованы в MVP. Пока нет подтверждённой статистики
            коммерческого эффекта на реальных пилотах. Генеративный AI-ассистент — не активная
            функция текущего продукта.
          </p>
        </section>

        <section id="competition" className={styles.section} aria-labelledby="competition-title">
          <ScrollReveal className={cn(styles.sectionHeading)}>
            <div>
              <p className={styles.kicker}>Конкурентная среда</p>
              <h2 id="competition-title">
                Мерч под ключ уже существует.
                <br />
                <span>Чем будет отличаться QAJET?</span>
              </h2>
            </div>
            <p>
              Брендирование, подбор подарков и доставка не являются уникальными преимуществами.
              QAJET строит управляемый процесс сравнения нескольких поставщиков и исполнения заказа.
            </p>
          </ScrollReveal>
          <div className={styles.competitorGrid}>
            {[
              {
                name: 'NAIRA Corporate',
                type: 'Казахстан',
                body: 'Онлайн-подбор корпоративных подарков под бюджет, брендирование и сопровождение.',
                url: 'https://corporate.naira.kz/',
              },
              {
                name: 'ÖRNE',
                type: 'Казахстан',
                body: 'Поиск товаров и производителей, варианты под задачу, производство и логистика.',
                url: 'https://orne.kz/services/sourcing',
              },
              {
                name: 'ADVERTAU',
                type: 'Казахстан',
                body: 'Мерч, полиграфия, корпоративные подарки и реализация проекта под ключ.',
                url: 'https://advertau.kz/',
              },
              {
                name: 'SwagUp',
                type: 'Международный',
                body: 'Платформа корпоративного мерча: комплектация, хранение и выполнение отправок.',
                url: 'https://www.swagup.com/',
              },
              {
                name: 'Sendoso',
                type: 'Международный',
                body: 'Корпоративные подарки, мерч и автоматизация логистики и закупочных сценариев.',
                url: 'https://www.sendoso.com/merch',
              },
            ].map(({ name, type, body, url }) => (
              <ScrollReveal key={name} className={cn(styles.competitorCard)}>
                <div className={styles.competitorMeta}>
                  <span>{type}</span>
                  <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Сайт ${name}`}>
                    <ArrowUpRight size={16} aria-hidden="true" />
                  </a>
                </div>
                <h3>{name}</h3>
                <p>{body}</p>
              </ScrollReveal>
            ))}
          </div>
          <ScrollReveal className={cn(styles.competitionAdvantage)}>
            <strong>Гипотеза преимущества QAJET</strong>
            <p>
              Один бриф → несколько сопоставимых планов → единый ответственный за результат.
              Проверяем на пилотах, удаётся ли снизить минуты закупщика, количество уточнений
              и отклонения от сроков.
            </p>
          </ScrollReveal>
        </section>

        <section id="progress" className={styles.section} aria-labelledby="progress-title">
          <ScrollReveal className={cn(styles.sectionHeading)}>
            <div>
              <p className={styles.kicker}>От личной боли к продукту</p>
              <h2 id="progress-title">
                Проблему уже проверяем.
                <br />
                <span>Следующий шаг — пилоты.</span>
              </h2>
            </div>
            <p>
              Идея родилась при подготовке мероприятия на 200 человек: около двух недель на закупки
              с бюджетом 2 млн ₸.
            </p>
          </ScrollReveal>
          <div className={styles.proofGrid}>
            <ScrollReveal delay={0.06}>
              <article>
                <span className={styles.proofValue}>
                  <IntCountUp value={9} />
                  <span> организаций</span>
                </span>
                <h3>В исследовании потребностей</h3>
                <p>Дочерняя компания банка, 6 университетов и 2 event-агентства.</p>
                <small>Customer discovery</small>
              </article>
            </ScrollReveal>
            <ScrollReveal delay={0.12}>
              <article>
                <span className={styles.proofValue}>
                  <IntCountUp value={2} /> млн
                  <span> ₸</span>
                </span>
                <h3>Закупочный бюджет</h3>
                <p>Реальный кейс сооснователя, из которого выросла идея QAJET.</p>
                <small>Опыт команды</small>
              </article>
            </ScrollReveal>
            <ScrollReveal delay={0.18}>
              <article>
                <span className={styles.proofValue}>
                  <IntCountUp value={300} />
                  <span>+</span>
                </span>
                <h3>Поставщиков в базе</h3>
                <p>Отправная точка для поиска исполнителей под закупочные задачи.</p>
                <small>База контактов</small>
              </article>
            </ScrollReveal>
          </div>
          <p className={styles.sourceNote}>
            По данным команды в питч-деке. Исследование и база поставщиков не означают платящих
            клиентов или исполненные заказы платформы.
          </p>
          <ScrollReveal delay={0.22} className={cn(styles.pilotRoadmap)}>
            <span className={styles.pilotLabel}>Цель следующего этапа</span>
            <strong>5 пилотных компаний</strong>
            <ArrowUpRight aria-hidden="true" size={18} />
            <strong>10 исполненных заказов</strong>
            <ArrowUpRight aria-hidden="true" size={18} />
            <strong>2 повторных клиента</strong>
          </ScrollReveal>
        </section>

        <section className={styles.section} aria-labelledby="prize-title">
          <ScrollReveal className={cn(styles.sectionHeading)}>
            <div>
              <p className={styles.kicker}>Pizza Pitch · 500 000 ₸</p>
              <h2 id="prize-title">
                Приз — не на рекламу идеи.
                <br />
                <span>На проверку реальных закупок.</span>
              </h2>
            </div>
            <p>План использования возможного приза на пилотную проверку спроса и экономики.</p>
          </ScrollReveal>
          <div className={styles.prizeGrid}>
            {[
              { amount: '200 000 ₸', label: 'Пилотные заказы и образцы' },
              { amount: '150 000 ₸', label: 'Контроль качества и логистика' },
              { amount: '100 000 ₸', label: 'Привлечение и интервью B2B-клиентов' },
              { amount: '50 000 ₸', label: 'Замеры эффективности и инфраструктура' },
            ].map(({ amount, label }) => (
              <ScrollReveal key={amount} className={cn(styles.prizeCard)}>
                <strong>{amount}</strong>
                <span>{label}</span>
              </ScrollReveal>
            ))}
          </div>
          <p className={styles.sourceNote}>
            Это план расходования призовых, а не уже понесённые расходы или достигнутые результаты.
          </p>
        </section>

        <section className={`${styles.section} ${styles.economics}`} aria-labelledby="model-title">
          <ScrollReveal className={cn(styles.modelCopy)}>
            <p className={styles.kicker}>Бизнес-модель</p>
            <h2 id="model-title">
              Зарабатываем,
              <br />
              когда заказ <span>исполнен.</span>
            </h2>
            <p>
              Сервисная наценка к стоимости товаров и работ поставщиков. Она покрывает подбор,
              сравнение предложений и сопровождение закупки.
            </p>
            <div className={styles.commission}>
              {COMMISSION_DEFAULT_PCT}
              <span>%</span>
            </div>
            <p className={styles.modelNote}>
              Стартовая гипотеза пилота. Доставка рассчитывается отдельно.
            </p>
          </ScrollReveal>
          <div className={styles.modelDetails}>
            <ScrollReveal className={cn(styles.example)}>
              <p className={styles.kicker}>Пример одного заказа</p>
              <div>
                <span>Стоимость поставщиков</span>
                <strong>
                  <MoneyCountUp value={750000} />
                </strong>
              </div>
              <div>
                <span>Сервисная наценка</span>
                <strong>{COMMISSION_DEFAULT_PCT}%</strong>
              </div>
              <div className={styles.exampleTotal}>
                <span>Доход сервиса до затрат</span>
                <strong>
                  <MoneyCountUp value={Math.round((750000 * COMMISSION_DEFAULT_PCT) / 100)} />
                </strong>
              </div>
              <small>
                Цена клиенту до доставки:{' '}
                {(750000 * (1 + COMMISSION_DEFAULT_PCT / 100)).toLocaleString('ru-RU')} ₸. Доход
                сервиса не равен прибыли.
              </small>
            </ScrollReveal>
            <ScrollReveal delay={0.08} className={cn(styles.market)}>
              <h3>Начинаем с повторяемых закупок</h3>
              <p>50 компаний × 6 заказов в год × 750 000 ₸</p>
              <strong>
                <IntCountUp value={225} /> млн ₸ <span>годового оборота заказов</span>
              </strong>
              <small>
                Расчётный объём закупок первого сегмента. Это не фактические продажи и не оценка
                всего рынка.
              </small>
            </ScrollReveal>
          </div>
        </section>

        <section id="contact" className={styles.section} aria-labelledby="contact-title">
          <div className={styles.contactGrid}>
            <ScrollReveal>
              <p className={styles.kicker}>Команда QAJET</p>
              <h2>
                Знаем закупки
                <br />
                <span>с обеих сторон.</span>
              </h2>
              <div className={styles.founders}>
                <ScrollReveal delay={0.06}>
                  <Image
                    className={styles.avatar}
                    src="/startupbattle/founder-ilyas.webp"
                    alt=""
                    width={46}
                    height={46}
                  />
                  <div>
                    <h3>Ильяс Азелханов</h3>
                    <p>Сооснователь</p>
                    <small>Продукт · Продажи · Закупки</small>
                  </div>
                </ScrollReveal>
                <ScrollReveal delay={0.12}>
                  <Image
                    className={styles.avatar}
                    src="/startupbattle/founder-aruzhan.webp"
                    alt=""
                    width={46}
                    height={46}
                  />
                  <div>
                    <h3>Аружан Каримова</h3>
                    <p>Сооснователь</p>
                    <small>Маркетинг · Операции · Клиенты</small>
                  </div>
                </ScrollReveal>
              </div>
            </ScrollReveal>
            <ScrollReveal delay={0.1} from="right" className={cn(styles.contactCard)}>
              <p className={styles.kicker}>Открыты к пилотам и партнёрствам</p>
              <h2 id="contact-title">
                Давайте начнём
                <br />с вашей <span>следующей закупки.</span>
              </h2>
              <p>Ищем 5 пилотных компаний. Возможный приз 500 000 ₸ направим на первые заказы и измерение эффективности.</p>
              <a
                href={contact}
                target="_blank"
                rel="noreferrer"
                className={`${styles.button} ${styles.limeButton}`}
              >
                Написать @qajet.io <ArrowUpRight size={18} aria-hidden="true" />
                <span className={styles.srOnly}> (Instagram, новая вкладка)</span>
              </a>
              <div className={styles.contactLinks}>
                <a href={whatsapp} target="_blank" rel="noreferrer" className={styles.contactLink}>
                  <MessageCircle size={16} aria-hidden="true" /> +7 700 020 47 91
                  <span className={styles.srOnly}> (WhatsApp, новая вкладка)</span>
                </a>
                <a href={linkedin} target="_blank" rel="noreferrer" className={styles.contactLink}>
                  <LinkIcon size={16} aria-hidden="true" /> LinkedIn
                  <span className={styles.srOnly}> (новая вкладка)</span>
                </a>
              </div>
              {pitch ? (
                <a className={styles.download} href={pitch} download="QAJET-pitch.pdf">
                  <ArrowDownToLine size={17} aria-hidden="true" /> Скачать презентацию · PDF
                </a>
              ) : (
                <p className={styles.download}>Презентацию пришлём по запросу — напишите нам.</p>
              )}
            </ScrollReveal>
          </div>
        </section>
      </main>

      <nav className={styles.mobileTabbar} aria-label="Быстрая навигация">
        <a href="#how-it-works">
          <ListChecks size={18} aria-hidden="true" />
          Как работает
        </a>
        <a href="#product">
          <Package size={18} aria-hidden="true" />
          Продукт
        </a>
        <a href="#progress">
          <TrendingUp size={18} aria-hidden="true" />
          Прогресс
        </a>
        <a href="#contact" className={cn(styles.mobileTabbarCta)}>
          <MessageCircle size={18} aria-hidden="true" />
          Пилот
        </a>
      </nav>

      <footer className={styles.footer}>
        <Link href="/" className={styles.logo}>
          QAJET<span>®</span>
        </Link>
        <p>
          Қажет — значит «нужно».
          <br />
          Больше времени для вашего бизнеса.
        </p>
        <span>Алматы · 2026</span>
        <a href="#main">Наверх ↑</a>
      </footer>
    </div>
  );
}
