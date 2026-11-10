'use client';

import { COMMISSION_DEFAULT_PCT } from '@qajet/engine/commission';

import { cn } from '@qajet/ui/lib/cn';
import { BarGrow, type BarSegment, CountUp, ScrollProgress } from '@qajet/ui/motion';
import { ArrowUpRight, Check, ChevronDown } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import styles from './startupbattle.module.css';

/**
 * Шапка сжимается при прокрутке — те же 80px→60px, что в мобильных
 * приложениях, где заголовок экономит место при чтении, но не исчезает
 * совсем (навигация остаётся доступной). Порог 12px — не дёргается на
 * микроскроллах тачпада.
 */
export function Header() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        setScrolled(window.scrollY > 12);
        ticking = false;
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`${styles.header} ${scrolled ? styles.headerScrolled : ''}`}>
      <ScrollProgress className={cn(styles.scrollProgress)} />
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
  );
}

const money = (value: number) => `${new Intl.NumberFormat('ru-RU').format(value)} ₸`;
const wholeNumber = (value: number) => String(Math.round(value));

/**
 * CountUp принимает функцию `format` — её нельзя передать пропом из
 * серверного page.tsx в клиентский компонент (RSC-граница не
 * сериализует функции). Оборачиваем здесь, где определение функции
 * форматирования и её использование — в одном клиентском модуле.
 */
export function MoneyCountUp({ value }: { value: number }) {
  return <CountUp value={value} format={money} />;
}
export function IntCountUp({ value }: { value: number }) {
  return <CountUp value={value} format={wholeNumber} />;
}
const parts = [
  { index: 0, label: 'Товар', color: 'ink' },
  { index: 1, label: 'Нанесение и работы', color: 'muted' },
  { index: 2, label: 'Доставка', color: 'muted' },
  { index: 3, label: 'Комиссия QAJET', color: 'purple' },
] as const satisfies readonly { index: number; label: string; color: BarSegment['color'] }[];
// Иллюстративные значения: комиссия всегда считается от товаров и работ,
// без доставки — тот же принцип, что и в production-калькуляторе.
const variants = [
  {
    title: 'Сбалансированный',
    note: 'Полная стоимость ниже',
    costs: [800000, 220000, 77650, Math.round(((800000 + 220000) * COMMISSION_DEFAULT_PCT) / 100)],
  },
  {
    title: 'Дешевле только товар',
    note: 'Больше расходов на работы и доставку',
    costs: [720000, 330000, 109000, Math.round(((720000 + 330000) * COMMISSION_DEFAULT_PCT) / 100)],
  },
] as const;
const variantTotals = variants.map((variant) =>
  variant.costs.reduce<number>((sum, cost) => sum + cost, 0),
);
const maxVariantTotal = Math.max(...variantTotals);
const comparisonDifference = Math.abs(variantTotals[0] - variantTotals[1]);

export function Comparison() {
  return (
    <div className={styles.comparison}>
      <div className={styles.comparisonTop}>
        <span>QAJET / Сравнение вариантов</span>
        <span className={styles.demoBadge}>Демо</span>
      </div>
      <h2>Мерч для команды</h2>
      <p className={styles.comparisonBrief}>100 наборов · Алматы · Одна задача</p>
      <div className={styles.variants}>
        {variants.map((variant, index) => (
          <div key={variant.title} className={styles.variant}>
            <div className={styles.variantHeading}>
              <span>
                {index === 0 && <Check size={14} aria-hidden="true" />}
                {variant.title}
              </span>
              <strong>{money(variant.costs.reduce<number>((a, b) => a + b, 0))}</strong>
            </div>
            <BarGrow
              index={index}
              heightClassName="h-7"
              segments={parts.map((part) => ({
                key: String(part.index),
                label: part.label,
                color: part.color,
                amountLabel: money(variant.costs[part.index]),
                fraction: variant.costs[part.index] / maxVariantTotal,
              }))}
            />
            <p>{variant.note}</p>
          </div>
        ))}
      </div>
      <div className={styles.comparisonTakeaway}>
        <span>Разница в полной стоимости</span>
        <strong>{money(comparisonDifference)}</strong>
      </div>
      <details className={styles.breakdown}>
        <summary>
          Из чего складывается цена <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className={styles.breakdownScroll}>
          <table>
            <caption className={styles.srOnly}>
              Декомпозиция стоимости демонстрационных вариантов
            </caption>
            <thead>
              <tr>
                <th scope="col">Статья</th>
                <th scope="col">Вариант 1</th>
                <th scope="col">Вариант 2</th>
              </tr>
            </thead>
            <tbody>
              {parts.map((part) => (
                <tr key={part.label}>
                  <th scope="row">{part.label}</th>
                  <td>{money(variants[0].costs[part.index])}</td>
                  <td>{money(variants[1].costs[part.index])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className={styles.comparisonDisclaimer}>Иллюстрация принципа сравнения. Цены условные.</p>
    </div>
  );
}

const screens = [
  {
    id: 'buyer',
    title: 'Покупатель',
    caption: 'Все закупки — в одном месте',
    description: 'Заказы, обновления и решения, которые ждут вашего согласования.',
  },
  {
    id: 'concierge',
    title: 'Консьерж',
    caption: 'Вся очередь заказов перед глазами',
    description: 'Единая доска для сопровождения закупок на каждом этапе.',
  },
  {
    id: 'supplier',
    title: 'Поставщик',
    caption: 'Запросы и производство',
    description: 'Рабочий кабинет поставщика: новые запросы, заказы и выплаты.',
  },
  {
    id: 'admin',
    title: 'Администратор',
    caption: 'Контроль поставщиков и платформы',
    description: 'Проверка компаний, очередь верификации и операционная сводка.',
  },
  {
    id: 'learning',
    title: 'Обучение системы',
    caption: 'История заказов улучшает расчёты',
    description: 'Точность оценок, запас по стоимости и история сроков поставщиков.',
  },
  {
    id: 'metrics',
    title: 'Метрики',
    caption: 'Экономика, которую можно проверить',
    description: 'Конверсия, оборот и комиссия. Все цифры на этом экране относятся к демо-базе.',
  },
];

export function ProductTour() {
  const [active, setActive] = useState(0);
  return (
    <div className={styles.tour}>
      <div className={styles.tabs} role="tablist" aria-label="Экраны продукта">
        {screens.map((item, index) => (
          <button
            type="button"
            role="tab"
            key={item.id}
            id={`tab-${item.id}`}
            aria-selected={active === index}
            aria-controls={`panel-${item.id}`}
            tabIndex={active === index ? 0 : -1}
            onClick={() => setActive(index)}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === 'ArrowRight') next = (index + 1) % screens.length;
              else if (event.key === 'ArrowLeft')
                next = (index + screens.length - 1) % screens.length;
              else if (event.key === 'Home') next = 0;
              else if (event.key === 'End') next = screens.length - 1;
              else return;
              event.preventDefault();
              setActive(next);
              const nextScreen = screens[next];
              if (nextScreen) document.getElementById(`tab-${nextScreen.id}`)?.focus();
            }}
          >
            {item.title}
          </button>
        ))}
      </div>
      {screens.map((item, index) => (
        <div
          key={item.id}
          role="tabpanel"
          id={`panel-${item.id}`}
          aria-labelledby={`tab-${item.id}`}
          hidden={active !== index}
        >
          <div className={styles.screenCaption}>
            <div>
              <h3>{item.caption}</h3>
              <p>{item.description}</p>
            </div>
            <a
              href={`/startupbattle/${item.id}.webp`}
              target="_blank"
              rel="noreferrer"
              aria-label={`Открыть экран «${item.title}» в новой вкладке`}
            >
              <span>Открыть экран</span>
              <ArrowUpRight size={18} aria-hidden="true" />
            </a>
          </div>
          {active === index && (
            <Image
              src={`/startupbattle/${item.id}.webp`}
              alt={`QAJET — ${item.title}. ${item.description} Демонстрационные данные.`}
              width={1440}
              height={900}
              sizes="(max-width: 1200px) 100vw, 1160px"
              className={styles.screen}
            />
          )}
        </div>
      ))}
    </div>
  );
}
