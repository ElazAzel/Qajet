/**
 * Все тексты ролика. Меняйте их здесь.
 *
 * ЗАГЛУШКА: названия поставщиков, составы, сроки и цены ниже —
 * демо-данные для ролика. Это не реальные сделки, не реальные поставщики
 * и не реальные цены. Метрики, клиенты и отзывы в ролик не добавляются:
 * продукт на стадии пилота.
 */

export const SITE_URL = 'qajet-seven.vercel.app';

export const INTRO = {
  // Главный заголовок сайта. Вторая строка выделяется ярким акцентом.
  headline: 'Скажите, что нужно купить.',
  headlineAccent: 'Остальное сделаем мы.',
} as const;

export const OUTRO = {
  subtitle: 'Внешний отдел закупок для бизнеса',
  cta: 'Обсудить закупку →',
  url: SITE_URL,
} as const;

export const DEMO = {
  appSection: 'Новая закупка',
  requestTitle: 'Что нужно купить?',
  // ЗАГЛУШКА: текст запроса, который печатается в поле ввода.
  requestText: '150 welcome-kit для новых сотрудников, бюджет до 2 млн ₸, к 20 октября',
  requestPlaceholder: 'Опишите задачу своими словами',
  searchButton: 'Найти варианты',
  resultsTitle: 'Готовые варианты с полной стоимостью',
  selectButton: 'Выбрать',
  selectedButton: 'Выбрано',
  optimalBadge: 'Оптимально',
  kitLabel: 'Состав набора',
  toastTitle: 'Заказ оформлен',
  toastSubtitle: 'договор и документы готовятся',
} as const;

export type Proposal = {
  supplier: string;
  kind: string;
  kit: string;
  deadline: string;
  // Суммы в тенге, уже с НДС. Строки складываются в итог.
  goods: number;
  branding: number;
  delivery: number;
  optimal: boolean;
};

// ЗАГЛУШКА: три демо-варианта. Порядок = порядок карточек слева направо.
// Карточка с optimal: true получает бейдж и в неё «кликает» курсор.
export const PROPOSALS: readonly Proposal[] = [
  {
    supplier: 'Поставщик A',
    kind: 'Мерч-производство',
    kit: 'Худи, термокружка, блокнот, стикерпак',
    deadline: 'Готово к 17 октября',
    goods: 1_440_000,
    branding: 330_000,
    delivery: 48_000,
    optimal: false,
  },
  {
    supplier: 'Поставщик B',
    kind: 'Мерч и упаковка',
    kit: 'Худи, бутылка, блокнот, ручка, шоппер',
    deadline: 'Готово к 15 октября',
    goods: 1_215_000,
    branding: 285_000,
    delivery: 42_000,
    optimal: true,
  },
  {
    supplier: 'Поставщик C',
    kind: 'Полиграфия и сувениры',
    kit: 'Футболка, кружка, блокнот',
    deadline: 'Готово к 19 октября',
    goods: 990_000,
    branding: 210_000,
    delivery: 60_000,
    optimal: false,
  },
];

export const PRICE_LABELS = {
  goods: 'Товар',
  branding: 'Брендирование',
  delivery: 'Доставка',
  total: 'Итого с НДС',
} as const;

/** 1542000 → «1 542 000 ₸» с неразрывными пробелами. */
export const formatTenge = (value: number): string =>
  `${String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₸`;
