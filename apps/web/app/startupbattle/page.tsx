import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  Gift,
  Link as LinkIcon,
  Megaphone,
  MessageCircle,
  Package,
  Users,
} from 'lucide-react';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import styles from './startupbattle.module.css';
import { Comparison, ProductTour } from './startupbattle-client';

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
const pitch = '/startupbattle/QAJET-pitch.pdf';

export default function StartupBattlePage() {
  return (
    <div className={styles.page}>
      <a className={styles.skip} href="#main">
        Перейти к содержимому
      </a>
      <header className={styles.header}>
        <div className={styles.nav}>
          <Link href="/" className={styles.logo} aria-label="QAJET — главная">
            QAJET<span>®</span>
          </Link>
          <nav aria-label="Навигация по странице" className={styles.navLinks}>
            <a href="#how-it-works">Как работает</a>
            <a href="#product">Продукт</a>
            <a href="#progress">Наш прогресс</a>
          </nav>
          <a href="#contact" className={styles.navCta}>
            Обсудить пилот <ArrowUpRight size={16} aria-hidden="true" />
          </a>
        </div>
      </header>

      <main id="main" className={styles.main}>
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <div className={styles.eyebrow}>
              <span className={styles.dot} /> Алматы, Казахстан{' '}
              <span className={styles.eyebrowDivider}>/</span> Pizza Pitch
            </div>
            <h1 id="hero-title">
              <span>Закупки</span> не должны отвлекать от бизнеса.
            </h1>
            <p className={styles.heroDescription}>
              Ваш внешний отдел закупок. От первого «нам нужно» до принятого заказа — с одним
              ответственным партнёром.
            </p>
            <div className={styles.heroActions}>
              <a href="#product" className={`${styles.button} ${styles.limeButton}`}>
                Посмотреть продукт <ArrowDown size={17} aria-hidden="true" />
              </a>
              <a href={pitch} target="_blank" rel="noreferrer" className={styles.deckLink}>
                Питч-дек <ArrowUpRight size={16} aria-hidden="true" />
                <span className={styles.srOnly}> (PDF, новая вкладка)</span>
              </a>
            </div>
            <p className={styles.heroFoot}>
              Одна задача. Согласованный бюджет.
              <br />
              Один закупочный партнёр.
            </p>
          </div>
          <div className={styles.heroDemo}>
            <Comparison />
            <p className={styles.demoCaption}>
              Сравниваем весь заказ: товар, работы, доставку и комиссию.
            </p>
          </div>
        </section>

        <div className={styles.audience}>
          <p>
            Для команд, у которых
            <br />
            <strong>закупки повторяются</strong>
          </p>
          <div>
            <Users size={21} aria-hidden="true" />
            <span>
              <strong>HR</strong>
              <small>Welcome-наборы и подарки</small>
            </span>
          </div>
          <div>
            <Megaphone size={21} aria-hidden="true" />
            <span>
              <strong>Маркетинг</strong>
              <small>Мерч и полиграфия</small>
            </span>
          </div>
          <div>
            <Gift size={21} aria-hidden="true" />
            <span>
              <strong>Мероприятия</strong>
              <small>Бейджи и материалы</small>
            </span>
          </div>
        </div>

        <section id="how-it-works" className={styles.section} aria-labelledby="process-title">
          <div className={styles.sectionHeading}>
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
          </div>
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
              <li key={number}>
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
          <div className={styles.distinction}>
            <Package size={22} aria-hidden="true" />
            <p>
              <strong>Ценность — в исполнении всей задачи.</strong> Подбор поставщиков, сопоставимые
              предложения и персональное сопровождение в одном месте.
            </p>
          </div>
        </section>

        <section
          id="product"
          className={`${styles.section} ${styles.productSection}`}
          aria-labelledby="product-title"
        >
          <div className={styles.sectionHeading}>
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
          </div>
          <ProductTour />
          <div className={styles.productBottom}>
            <p>
              <span className={styles.statusDot} /> MVP в разработке · На экранах демонстрационные
              данные
            </p>
            <Link href="/login">
              Открыть платформу <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </section>

        <section id="progress" className={styles.section} aria-labelledby="progress-title">
          <div className={styles.sectionHeading}>
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
          </div>
          <div className={styles.proofGrid}>
            <article>
              <span className={styles.proofValue}>
                9<span> организаций</span>
              </span>
              <h3>В исследовании потребностей</h3>
              <p>Дочерняя компания банка, 6 университетов и 2 event-агентства.</p>
              <small>Customer discovery</small>
            </article>
            <article>
              <span className={styles.proofValue}>
                2 млн<span> ₸</span>
              </span>
              <h3>Закупочный бюджет</h3>
              <p>Реальный кейс сооснователя, из которого выросла идея QAJET.</p>
              <small>Опыт команды</small>
            </article>
            <article>
              <span className={styles.proofValue}>
                300<span>+</span>
              </span>
              <h3>Поставщиков в базе</h3>
              <p>Отправная точка для поиска исполнителей под закупочные задачи.</p>
              <small>База контактов</small>
            </article>
          </div>
          <p className={styles.sourceNote}>
            По данным команды в питч-деке. Исследование и база поставщиков не означают платящих
            клиентов или исполненные заказы платформы.
          </p>
          <div className={styles.pilotRoadmap}>
            <span className={styles.pilotLabel}>Цель следующего этапа</span>
            <strong>5 пилотных компаний</strong>
            <ArrowUpRight aria-hidden="true" size={18} />
            <strong>10 исполненных заказов</strong>
            <ArrowUpRight aria-hidden="true" size={18} />
            <strong>2 повторных клиента</strong>
          </div>
        </section>

        <section className={`${styles.section} ${styles.economics}`} aria-labelledby="model-title">
          <div className={styles.modelCopy}>
            <p className={styles.kicker}>Бизнес-модель</p>
            <h2 id="model-title">
              Зарабатываем,
              <br />
              когда заказ <span>исполнен.</span>
            </h2>
            <p>
              Планируемая комиссия — за поиск поставщиков, сравнение предложений и сопровождение
              заказа.
            </p>
            <div className={styles.commission}>
              7–10<span>%</span>
            </div>
            <p className={styles.modelNote}>Модель из питч-дека. Экономику проверяем в пилотах.</p>
          </div>
          <div className={styles.modelDetails}>
            <div className={styles.example}>
              <p className={styles.kicker}>Пример одного заказа</p>
              <div>
                <span>Сумма заказа</span>
                <strong>750 000 ₸</strong>
              </div>
              <div>
                <span>Комиссия QAJET</span>
                <strong>7%</strong>
              </div>
              <div className={styles.exampleTotal}>
                <span>Выручка QAJET</span>
                <strong>52 500 ₸</strong>
              </div>
              <small>Выручка до операционных расходов, не прибыль.</small>
            </div>
            <div className={styles.market}>
              <h3>Начинаем с повторяемых закупок</h3>
              <p>50 компаний × 6 заказов в год × 750 000 ₸</p>
              <strong>
                225 млн ₸ <span>годового оборота заказов</span>
              </strong>
              <small>
                Расчётный сценарий: 15,75 млн ₸ выручки при 7%. Не фактические продажи и не прогноз.
              </small>
            </div>
          </div>
        </section>

        <section id="contact" className={styles.section} aria-labelledby="contact-title">
          <div className={styles.contactGrid}>
            <div>
              <p className={styles.kicker}>Команда QAJET</p>
              <h2>
                Знаем закупки
                <br />
                <span>с обеих сторон.</span>
              </h2>
              <div className={styles.founders}>
                <div>
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
                </div>
                <div>
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
                </div>
              </div>
            </div>
            <div className={styles.contactCard}>
              <p className={styles.kicker}>Открыты к пилотам и партнёрствам</p>
              <h2 id="contact-title">
                Давайте начнём
                <br />с вашей <span>следующей закупки.</span>
              </h2>
              <p>Ищем 5 пилотных компаний и 1 млн ₸ на тестирование и отладку процесса.</p>
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
              <a className={styles.download} href={pitch} download="QAJET-pitch.pdf">
                <ArrowDownToLine size={17} aria-hidden="true" /> Скачать презентацию · PDF
              </a>
            </div>
          </div>
        </section>
      </main>
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
