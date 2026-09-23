/**
 * Все тексты и данные ролика.
 *
 * Два вида содержимого, их важно не путать:
 *
 * 1. ТЕКСТ ИНТЕРФЕЙСА. Скопирован дословно из apps/web (путь указан у блока).
 *    Если в продукте поменяли подпись, поменяйте её здесь, иначе ролик
 *    покажет интерфейс, которого уже нет.
 *
 * 2. ЗАГЛУШКА. Суммы, даты, названия и счётчики — демо-данные для ролика,
 *    не реальная сделка. Разбор запроса (ENGINE_PARSE) — настоящий вывод
 *    @qajet/engine/intake на этой фразе. Персоны — из демо-сида
 *    packages/db/src/seed/accounts.ts. Метрики, клиенты и отзывы в ролик
 *    не добавляются: продукт на стадии пилота (§13, §17).
 */

export const SITE_HOST = 'qajet-seven.vercel.app';

// Лендинг: apps/web/app/page.tsx
export const LANDING = {
  eyebrow: 'Внешний отдел закупок для бизнеса',
  headline: 'Скажите, что нужно купить.',
  headlineAccent: 'Остальное сделаем мы.',
  cta: 'Обсудить закупку →',
  // REASONS: три отличия с лендинга, заголовки дословно.
  reasons: [
    'Один договор и один счёт',
    'Видно, почему дешевле',
    'Повторить — без повторного описания',
  ],
  demoNote: 'Цифры демонстрационные — это пример экрана сравнения, а не реальная сделка.',
} as const;

// Подписи шагов ролика. Тексты — с лендинга (STEPS) и из мастера заявки (NEXT_STEPS).
export const CAPTIONS = {
  describe: {
    step: '1',
    title: 'Опишите задачу',
    sub: 'Своими словами: что, сколько и к какому сроку',
  },
  autofill: { step: '1', title: 'Поля заполнятся сами', sub: 'Мы разберём текст, вы подтвердите' },
  sourcing: {
    step: '2',
    title: 'Мы собираем предложения',
    sub: 'И отсеиваем то, что не успеет или не подойдёт',
  },
  compare: {
    step: '3',
    title: 'Видно, почему дешевле',
    sub: 'Дешёвое КП оказывается дороже после налогового эффекта',
  },
  approve: {
    step: '3',
    title: 'Вы утверждаете план',
    sub: 'С этого момента это заказ',
  },
  done: {
    step: '4',
    title: 'Получаете заказ и документы',
    sub: 'Приёмка, сверка и закрывающие документы',
  },
} as const;

// Оболочка покупателя: apps/web/app/buyer/layout.tsx, packages/ui/src/shell.
export const SHELL = {
  brand: 'QAJET',
  nav: ['Закупки', 'Новая заявка', 'Сообщения', 'Команда', 'Настройки'] as const,
  search: 'Заказ, поставщик, позиция…',
  shortcut: '⌘K',
  // Персона из демо-сида (владелец компании-покупателя, без лимита согласования).
  userName: 'Айгерим Сатпаева',
  userMeta: 'ТОО «Nomad Retail Group»',
  conciergeName: 'Мадина Жумабекова',
} as const;

// Мастер заявки: apps/web/app/buyer/requests/new/page.tsx
export const NEW_REQUEST = {
  crumbRoot: 'Закупки',
  crumb: 'Новая заявка',
  title: 'Новая заявка',
  sub: 'Опишите задачу и добавьте позиции — консьерж оценит стоимость и подберёт исполнителей.',
  cardTitle: 'Расскажите о задаче',
  cardSub:
    'Начните с описания своими словами. Название, город и хотя бы одна позиция обязательны — остальное поможет точнее оценить сроки.',
  quickLabel: 'Что нужно закупить?',
  quickHint:
    'Напишите своими словами — что, сколько и к какому сроку. Поля ниже заполнятся сами, и их можно поправить.',
  parse: 'Разобрать',
  previewTitle: 'Что мы поняли',
  accept: 'Добавить в заявку',
  dismiss: 'Не добавлять',
  fieldTitle: 'Название заявки',
  fieldTitlePlaceholder: 'Например, корпоративные подарки на Наурыз',
  fieldCity: 'Город доставки',
  fieldDescription: 'Описание заявки',
  fieldDescriptionPlaceholder: 'Для кого, к какому событию, особые пожелания…',
  fieldBudget: 'Бюджет, ориентировочно',
  fieldDate: 'Нужна дата доставки',
  fieldAddress: 'Адрес доставки',
  fieldAddressPlaceholder: 'Офис, склад…',
  itemsLegend: 'Позиции',
  itemLabel: 'Позиция',
  itemQtyLabel: 'Кол-во, набор',
  itemRemove: 'Убрать',
  itemsEmpty: 'Позиций пока нет.',
  itemsAddEmpty: 'Добавить позицию из каталога',
  itemsAddMore: '+ Ещё позиция из каталога',
  cancel: 'Отмена',
  submit: 'Отправить заявку',
  submitting: 'Отправляю…',
  summaryTitle: 'Кратко о заявке',
  summaryItems: 'Позиций',
  summaryCity: 'Город доставки',
  summaryDate: 'Планируемая дата',
  summaryBudget: 'Бюджет',
  notSetDate: 'Не указана',
  notSetBudget: 'Не указан',
  nextTitle: 'Что дальше?',
  nextSteps: [
    [
      'Вы описываете задачу и выбираете позиции',
      'Можно вставить текст — мы разберём его, вы подтвердите',
    ],
    ['Консьерж берёт заявку в работу и оценивает её', 'Реальный расчёт по истории цен, не догадка'],
    [
      'QAJET собирает предложения исполнителей',
      'Вы видите срок и решения по каждой позиции — без лишних деталей',
    ],
    [
      'Вы утверждаете план — с этого момента это заказ',
      'Полная декомпозиция суммы, без скрытых строк',
    ],
  ] as const,
} as const;

/**
 * ЗАГЛУШКА: запрос покупателя. Фраза подобрана так, что настоящий парсер
 * (packages/engine/src/intake/parse.ts, каталог packages/engine/src/catalog)
 * разбирает её без уточнений. Ниже — его фактический вывод на 23.09.2026.
 * Токены — куски фразы, которые «перелетают» в разобранные поля.
 */
export const REQUEST_TEXT =
  '150 welcome-наборов для новых сотрудников до 20 октября, бюджет 2 млн ₸';
export const REQUEST_TOKENS = [
  { text: '150 welcome-наборов для новых сотрудников', target: 'item' },
  { text: 'до 20 октября', target: 'deadline' },
  { text: 'бюджет 2 млн ₸', target: 'budget' },
] as const;
export const ENGINE_PARSE = {
  itemLabel: 'Welcome-набор для новых сотрудников',
  qty: 150,
  unit: 'набор',
  deadline: '2026-10-20',
  budgetKzt: 2_000_000,
} as const;

// ЗАГЛУШКА: название заявки, которое покупатель вводит вручную (поле обязательное).
export const REQUEST_TITLE = 'Welcome-наборы для новичков';
export const REQUEST_CITY = 'Алматы';
// Как выглядит поле type="date" в Chrome с русской локалью.
export const REQUEST_DATE_INPUT = '20.10.2026';

// Страница закупки: apps/web/app/buyer/requests/[id]/page.tsx, lib/buyer-stage.ts.
export const CASE = {
  waitingOn: 'Сейчас ход за',
  expected: 'Ожидаемая дата',
  updated: 'Обновлено',
  compositionTitle: 'Состав заявки',
  city: 'Город доставки',
  budget: 'Бюджет',
} as const;

export type CaseStageKey =
  | 'received'
  | 'estimated'
  | 'sourcing'
  | 'planProposed'
  | 'planApproved'
  | 'inProduction'
  | 'shipped'
  | 'delivered'
  | 'accepted'
  | 'closed';

type StageCopy = {
  label: string;
  tone: 'neutral' | 'pending' | 'progress' | 'success';
  headline: string;
  waiting: string | null;
  action: string | null;
  // ЗАГЛУШКА: даты «Обновлено» и «Ожидаемая дата» для таймлапса.
  updated: string;
  expected: string;
};

// Тексты стадий — дословно из describeCase() в apps/web/app/lib/buyer-stage.ts.
export const STAGES: Record<CaseStageKey, StageCopy> = {
  received: {
    label: 'Получено',
    tone: 'neutral',
    headline: 'Заявка получена — консьерж скоро возьмёт её в работу.',
    waiting: 'QAJET',
    action: null,
    updated: '23 сентября',
    expected: '20 октября',
  },
  estimated: {
    label: 'Нужно ваше решение',
    tone: 'pending',
    headline:
      'Оценка готова. После оплаты счёта на предоплату мы запросим предложения исполнителей.',
    waiting: 'Вы',
    action: 'Оплатить счёт на предоплату',
    updated: '23 сентября',
    expected: '20 октября',
  },
  sourcing: {
    label: 'Подбираем исполнителей',
    tone: 'progress',
    headline: 'Собираем предложения исполнителей и сравниваем варианты.',
    waiting: 'QAJET',
    action: null,
    updated: '24 сентября',
    expected: '20 октября',
  },
  planProposed: {
    label: 'Нужно ваше решение',
    tone: 'pending',
    headline: 'Мы подготовили варианты исполнения. Выберите подходящий и утвердите.',
    waiting: 'Вы',
    action: 'Выбрать вариант и утвердить',
    updated: '25 сентября',
    expected: '15 октября',
  },
  planApproved: {
    label: 'Исполняем',
    tone: 'progress',
    headline: 'План утверждён. Оформляем работу с исполнителями.',
    waiting: 'QAJET',
    action: null,
    updated: '25 сентября',
    expected: '15 октября',
  },
  inProduction: {
    label: 'Исполняем',
    tone: 'progress',
    headline: 'Заказ в производстве.',
    waiting: 'Исполнитель',
    action: null,
    updated: '29 сентября',
    expected: '15 октября',
  },
  shipped: {
    label: 'Исполняем',
    tone: 'progress',
    headline: 'Заказ отправлен — ждём подтверждения доставки.',
    waiting: 'Исполнитель',
    action: null,
    updated: '13 октября',
    expected: '15 октября',
  },
  delivered: {
    label: 'Нужна приёмка',
    tone: 'pending',
    headline: 'Заказ доставлен. Проверьте его и примите поставку.',
    waiting: 'Вы',
    action: 'Принять поставку',
    updated: '14 октября',
    expected: '15 октября',
  },
  accepted: {
    label: 'Нужна приёмка',
    tone: 'pending',
    headline: 'Поставка принята. Осталось подтвердить сверку по оплате и закрыть заказ.',
    waiting: 'Вы',
    action: 'Подтвердить сверку и закрыть',
    updated: '15 октября',
    expected: '15 октября',
  },
  closed: {
    label: 'Завершено',
    tone: 'success',
    headline: 'Заказ закрыт. Закрывающие документы — ниже.',
    waiting: null,
    action: null,
    updated: '16 октября',
    expected: '15 октября',
  },
};

/**
 * ЗАГЛУШКА: три варианта исполнения. Логика вариантов — как в combine.ts
 * (§8D): «Дешевле» — минимальная стоимость исполнения, «Рекомендованный» —
 * минимум при запасе по сроку ≥ 3 дн., «С запасом по сроку» — ≤ 110 %
 * от рекомендованного. Налоговый эффект не входит в стоимость исполнения,
 * он показывается отдельно — поэтому дешёвое КП может оказаться дороже по факту.
 * Имён исполнителей покупатель не видит (§10) — их нет и в ролике.
 */
export type PlanKey = 'recommended' | 'cheaper' | 'moreSlack';
export type Plan = {
  key: PlanKey;
  // PLAN_LABEL из apps/web/app/lib/order-state.ts
  label: string;
  // Подпись полосы на экране сравнения (как на лендинге).
  barLabel: string;
  goods: number;
  work: number;
  delivery: number;
  commission: number;
  taxEffect: number;
  eta: string;
  slackDays: number;
  suppliers: number;
};

export const PLANS: readonly Plan[] = [
  {
    key: 'recommended',
    label: 'Рекомендованный',
    barLabel: 'Рекомендованный',
    goods: 1_020_000,
    work: 230_000,
    delivery: 48_000,
    commission: 150_000,
    taxEffect: 36_000,
    eta: '2026-10-15',
    slackDays: 5,
    suppliers: 2,
  },
  {
    key: 'cheaper',
    label: 'Дешевле',
    barLabel: 'Дешевле по КП, дороже по факту',
    goods: 960_000,
    work: 215_000,
    delivery: 66_000,
    commission: 141_000,
    taxEffect: 196_000,
    eta: '2026-10-19',
    slackDays: 1,
    suppliers: 3,
  },
  {
    key: 'moreSlack',
    label: 'С запасом по сроку',
    barLabel: 'С запасом по сроку',
    goods: 1_060_000,
    work: 236_000,
    delivery: 48_000,
    commission: 156_000,
    taxEffect: 36_000,
    eta: '2026-10-11',
    slackDays: 9,
    suppliers: 1,
  },
];

/** Стоимость исполнения: то, что видно в карточке варианта (без налогового эффекта). */
export const planTotal = (p: Plan): number => p.goods + p.work + p.delivery + p.commission;
/** Итог «по факту»: стоимость исполнения + налоговый эффект, как на полосе. */
export const planFactTotal = (p: Plan): number => planTotal(p) + p.taxEffect;

// Экран плана: apps/web/app/buyer/orders/[id]/_order-view.tsx, _plan-alternatives.tsx
export const PLAN_VIEW = {
  delivery: 'Доставка',
  toConfirm: 'Перейти к подтверждению',
  history: 'История изменений условий →',
  chooseTitle: 'Выбор варианта',
  chooseSub:
    'Все варианты относятся к одной проверенной ревизии. Выбранный вариант будет зафиксирован на экране подтверждения.',
  selected: 'Выбран',
  select: 'Выбрать',
  rejectionsTitle: 'Что не прошло и почему',
  rejectionsSub:
    'Предложения, отбракованные при сборке плана. Причины — по существу; кто именно предлагал, подбирает и проверяет QAJET.',
  closedTitle: 'Заказ закрыт',
  finalCost: 'Итоговая стоимость',
  documentsTitle: 'Документы заказа',
  open: 'Открыть',
  print: 'Печать / PDF',
  historyTitle: 'История заказа',
} as const;

// Причины — дословно из REJECTION_REASONS (packages/engine/src/combine/combine.ts).
// ЗАГЛУШКА: количество отсеянных предложений.
export const REJECTIONS = [
  { reason: 'Прогноз срока поставки этого предложения не укладывается в дедлайн заказа', count: 2 },
  { reason: 'В предложении остались незакрытые уточнения по критичным полям', count: 1 },
] as const;

// Типы документов — DOCUMENT_LABEL из _order-view.tsx. Порядок — как в выдаче (новые сверху).
export const DOCUMENTS = ['Итоговый счёт', 'Акт выполненных работ', 'Счёт на предоплату'] as const;

// ЗАГЛУШКА: история заказа. Подписи стадий — ORDER_STATE_LABEL (lib/order-state.ts),
// исполнитель для покупателя виден как «Поставщик» (lib/buyer-order.ts).
export const ORDER_EVENTS = [
  { label: 'План утверждён', actor: SHELL.userName, at: '25 сент.' },
  { label: 'Поставщики оплачены', actor: SHELL.conciergeName, at: '26 сент.' },
  { label: 'В производстве', actor: 'Поставщик', at: '29 сент.' },
  { label: 'Отгружен', actor: 'Поставщик', at: '13 окт.' },
  { label: 'Доставлен', actor: 'Поставщик', at: '14 окт.' },
  { label: 'Принят', actor: SHELL.userName, at: '15 окт.' },
  { label: 'Закрыт', actor: SHELL.userName, at: '16 окт.' },
] as const;

// Экран подтверждения: apps/web/app/buyer/orders/[id]/confirm/*, lib/order-confirmation.ts
export const CONFIRM = {
  back: '← К заказу',
  title: 'Подтверждение заказа',
  sub: 'Проверьте условия перед подтверждением. После подтверждения план фиксируется: изменение создаёт новую версию, а не правит утверждённую.',
  executor: 'Исполнитель',
  // Реквизиты в ролике размыты: это демо-данные сида, а не реальные счета.
  executorName: 'ТОО "QAJET"',
  executorLines: [
    'БИН 000000000000',
    'г. Алматы',
    'Банк, IBAN KZ00 0000 0000 0000 0000, БИК XXXXKZKA',
  ],
  customer: 'Заказчик',
  customerName: SHELL.userMeta,
  customerLines: ['БИН 000000000000', 'плательщик НДС'],
  composition: 'Состав заказа',
  term: 'Срок и доставка',
  termRows: [
    ['Плановый срок', '2026-10-15'],
    ['Дедлайн заявки', '2026-10-20'],
    ['Адрес доставки', 'Алматы'],
    ['Способ доставки', 'Доставка силами QAJET до указанного адреса'],
  ] as const,
  cost: 'Стоимость исполнения заказа',
  costDelivery: 'в том числе доставка',
  version: 'Версия плана 1',
  paymentTitle: 'Порядок оплаты',
  payment:
    'Безналичный перевод на расчётный счёт QAJET. Предоплата выставляется по счёту на P80 оценки, остаток — после приёмки и сверки. Эквайринг, QR-платежи и наличные не принимаются.',
  returnTitle: 'Условия возврата и сверки',
  returns:
    'При закрытии заказа предоплата сверяется с фактической стоимостью: разница возвращается на ваш счёт либо выставляется к доплате. Несоответствие приёмке фиксируется как спор до закрытия.',
  cta: 'Подтверждаю заказ на этих условиях',
  ctaPending: 'Подтверждаю…',
  ctaNote: 'Будет зафиксировано: кто, когда и какую версию плана подтвердил (версия 1).',
  audit: 'Зафиксировано в журнале',
  auditSub: `${SHELL.userName} · версия плана 1`,
} as const;

// ЗАГЛУШКА: даты на счётчике таймлапса.
export const TIMELAPSE = {
  sourcing: ['23 сент.', '24 сент.', '25 сент.'],
  execution: ['25 сент.', '29 сент.', '13 окт.', '15 окт.', '16 окт.'],
} as const;

// ЗАГЛУШКА: адреса страниц. Идентификатор заявки выдуман.
export const URLS = {
  newRequest: `${SITE_HOST}/buyer/requests/new`,
  request: `${SITE_HOST}/buyer/requests/5b2e9c1a-7d4f-4e21-9a3b-2f6c8d1e0a47`,
  confirm: `${SITE_HOST}/buyer/orders/c81f4a02-3e9b-4d6a-b715-0e2d9f6a3c58/confirm`,
} as const;

/** Intl ru-KZ, как formatKzt() в packages/ui/src/primitives/money.tsx: «1 448 000 ₸». */
export const formatKzt = (value: number): string =>
  new Intl.NumberFormat('ru-KZ', {
    style: 'currency',
    currency: 'KZT',
    maximumFractionDigits: 0,
  }).format(Math.round(value));

/** pluralizeRu для «поставщик» (apps/web/app/lib/pluralize.ts). */
export const supplierWord = (n: number): string => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'поставщик';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'поставщика';
  return 'поставщиков';
};
