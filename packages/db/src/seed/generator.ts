import { randomUUID } from 'node:crypto';
import { type CombineResult, combine, type QuoteOffer as EngineOffer } from '@qajet/engine/combine';
import { allocateCommission } from '@qajet/engine/costing';
import {
  estimate as engineEstimate,
  type PriceObservation as LearnObservation,
} from '@qajet/engine/estimate';
import type { Explanation } from '@qajet/engine/explain';
import {
  calculateSupplierReliability,
  predictAfterQuote,
  type SupplierLeadHistoryEntry,
} from '@qajet/engine/leadtime';
import type { OrderOutcome } from '@qajet/engine/learn';
import { recalibrate } from '@qajet/engine/learn';
import { roundKzt } from '@qajet/engine/money';
import { TIME_ENTRY_STAGE_BY_STATE, type TimeEntryStage } from '@qajet/engine/order';
import type * as schema from '../schema/index.js';
import {
  DEMO_SUPPLIER_COMPANY_SEED_KEY,
  SEED_ACCOUNTS,
  SEED_BUYER_COMPANY,
  SEED_SUPPLIER_COMPANIES,
} from './accounts.js';
import { type CatalogItem, catalogInCategory, SEED_CATALOG } from './catalog.js';
import {
  CIT_RATE_PCT,
  COMMISSION_RATE_PCT,
  LOGISTICS_BUFFER_ALMATY_DAYS,
  LOGISTICS_BUFFER_INTERCITY_DAYS,
  LOGISTICS_DELIVERY_INTERCITY_KZT,
  LOGISTICS_DELIVERY_LOCAL_KZT,
  OPERATIONAL_SETTINGS,
} from './operational-settings.js';
import { createRng, pickMany, randInt } from './random.js';
import type { SeedCategory } from './suppliers.js';

/**
 * Генератор сида (agents.md §13) — единый детерминированный проход по
 * пулу категорий, растущему по ходу генерации: каждый следующий закрытый
 * заказ видит наблюдения и ошибки прошлых, поэтому запас/MAPE в снимках
 * модели снижаются по-настоящему, посчитано движком, а не подрисовано.
 *
 * `orders` создаётся сразу при появлении заявки (не после утверждения
 * плана): approvedPlanId not null, поэтому вместе с заказом сразу пишется
 * план-заглушка (version 1, kind 'manual', status 'draft'); когда combine()
 * реально считает вариант, появляется version 2 и заглушка помечается
 * superseded — так orders.state способен пройти весь orderStateEnum,
 * включая ранние стадии до появления настоящего плана.
 */

// ---------------------------------------------------------------------------
// Константы и настройки
// ---------------------------------------------------------------------------

/**
 * Базовые АКТИВНЫЕ минуты консьержа на стадию (agents.md §9). Именно
 * активные — не календарное время между переходами: стадия «производство»
 * длится неделю, но консьерж тратит на неё минуты. Числа — порядок величины
 * ручной работы закупщика, а не замер; нормализация КП самая тяжёлая, это
 * ровно та работа, которую продукт и автоматизирует.
 */
const ACTIVE_MINUTES_BY_TIME_ENTRY_STAGE: Record<TimeEntryStage, number> = {
  intake: 25,
  sourcing: 35,
  normalization: 45,
  approval: 10,
  execution: 15,
  closing: 20,
  exception: 30,
};

/**
 * Насколько падают часы на заказ к концу истории (§13, сцена 8: «часы на
 * заказ падают, точность растёт»). Падение — следствие накопленной истории
 * (шаблоны, известные поставщики, меньше уточнений), поэтому масштабируется
 * тем же `progress`, что и качество моделей.
 */
const ACTIVE_TIME_LEARNING_DROP = 0.45;

/**
 * Заголовок заявки демо-заказа §13 — единственный устойчивый признак, по
 * которому его можно отличить от боевых заказов. Экспортируется, потому что
 * `pnpm db:demo-order` обязан сносить ПРЕДЫДУЩИЙ демо-заказ, а не любой
 * заказ на стадии `quotes_received`: на непустой базе это удаляло бы чужую
 * живую заявку вместе со всем, что на неё каскадом завязано.
 */
export const DEMO_ORDER_REQUEST_TITLE = 'Демо: мерч к корпоративному мероприятию';

/** Те же демо-значения, что settings.qajet_requisites (agents.md §11.3) —
 *  Document Engine подставляет их и в живой счёт/акт, и здесь, в историю сида. */
const QAJET_SEED_REQUISITES = {
  legalName: 'ТОО "QAJET"',
  bin: '241140012345',
  address: 'г. Алматы, Бостандыкский р-н, ул. Розыбакиева 247',
  bankName: 'АО "Kaspi Bank"',
  iban: 'KZ123456789012345678',
  bik: 'CASPKZKA',
  phone: '+7 727 000 00 00',
  email: 'billing@qajet.kz',
};

const HISTORY_ORDER_COUNT = 24;
const HISTORY_SPAN_START_DAYS = 270;
const HISTORY_SPAN_END_DAYS = 14;
/** Скользящее окно последних ошибок на категорию для P80 запаса — см. комментарий у пуша. */
const RELATIVE_ERROR_WINDOW = 6;
const CATEGORIES: readonly SeedCategory[] = ['merch', 'corporate-gifts', 'printing'];

const CANONICAL_ORDER_STATES = [
  'draft',
  'estimated',
  'prepaid',
  'rfq_sent',
  'quotes_received',
  'plan_proposed',
  'plan_approved',
  'suppliers_paid',
  'in_production',
  'shipped',
  'delivered',
  'accepted',
  'closed',
] as const;

type CanonicalState = (typeof CANONICAL_ORDER_STATES)[number];
type OrderState = (typeof schema.orderStateEnum.enumValues)[number];

/** Исключительные ветки — состояние → точка ветвления в канонической последовательности (для расчёта длины цикла). */
const EXCEPTION_BRANCHES: Record<
  'awaiting_internal_approval' | 'on_hold' | 'cancelled' | 'disputed',
  CanonicalState
> = {
  cancelled: 'rfq_sent',
  awaiting_internal_approval: 'plan_proposed',
  on_hold: 'plan_approved',
  disputed: 'delivered',
};

// ---------------------------------------------------------------------------
// Даты
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

function isoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Курсор времени внутри одного заказа — гарантирует монотонный рост меток стадий. */
class Clock {
  private current: Date;
  constructor(start: Date) {
    this.current = start;
  }
  now(): Date {
    return this.current;
  }
  advance(days: number): Date {
    this.current = addDays(this.current, days);
    return this.current;
  }
}

// ---------------------------------------------------------------------------
// Типы строк (выведены из самой Drizzle-схемы — имена полей не гадаются)
// ---------------------------------------------------------------------------

type CompanyRow = typeof schema.companies.$inferInsert;
type UserRow = typeof schema.users.$inferInsert;
type SupplierProfileRow = typeof schema.supplierProfiles.$inferInsert;
type SupplierStatsRow = typeof schema.supplierStats.$inferInsert;
type RequestRow = typeof schema.requests.$inferInsert;
type RequestItemRow = typeof schema.requestItems.$inferInsert;
type EstimateRow = typeof schema.estimates.$inferInsert;
type PrepaymentRow = typeof schema.prepayments.$inferInsert;
type RfqRow = typeof schema.rfqs.$inferInsert;
type QuoteRow = typeof schema.quotes.$inferInsert;
type QuoteLineRow = typeof schema.quoteLines.$inferInsert;
type PlanRow = typeof schema.plans.$inferInsert;
type PlanLineRow = typeof schema.planLines.$inferInsert;
type PlanRejectionRow = typeof schema.planRejections.$inferInsert;
type OrderRow = typeof schema.orders.$inferInsert;
type OrderStageEventRow = typeof schema.orderStageEvents.$inferInsert;
type SupplierPayoutRow = typeof schema.supplierPayouts.$inferInsert;
type PaymentFactRow = typeof schema.paymentFacts.$inferInsert;
type DocumentRow = typeof schema.documents.$inferInsert;
type RatingRow = typeof schema.ratings.$inferInsert;
type LearningEventRow = typeof schema.learningEvents.$inferInsert;
type PriceObservationRow = typeof schema.priceObservations.$inferInsert;
type ModelSnapshotRow = typeof schema.modelSnapshots.$inferInsert;
type SettingRow = typeof schema.settings.$inferInsert;
type TimeEntryRow = typeof schema.timeEntries.$inferInsert;
type ThreadRow = typeof schema.threads.$inferInsert;
type MessageRow = typeof schema.messages.$inferInsert;
type PermissionRow = typeof schema.permissions.$inferInsert;
type ChangeRequestRow = typeof schema.changeRequests.$inferInsert;

export interface SeedAccountLink {
  seedKey: string;
  email: string;
  password: string;
  fullName: string;
  userId: string;
  companyId: string | null;
  isQuickLogin: boolean;
  /** false → аккаунт уже существовал (переиспользован), auth/users-строку создавать не нужно. */
  isNew: boolean;
}

export interface SeedDataset {
  companies: CompanyRow[];
  users: UserRow[];
  supplierProfiles: SupplierProfileRow[];
  supplierStats: SupplierStatsRow[];
  requests: RequestRow[];
  requestItems: RequestItemRow[];
  estimates: EstimateRow[];
  prepayments: PrepaymentRow[];
  rfqs: RfqRow[];
  quotes: QuoteRow[];
  quoteLines: QuoteLineRow[];
  plans: PlanRow[];
  planLines: PlanLineRow[];
  planRejections: PlanRejectionRow[];
  orders: OrderRow[];
  orderStageEvents: OrderStageEventRow[];
  supplierPayouts: SupplierPayoutRow[];
  paymentFacts: PaymentFactRow[];
  documents: DocumentRow[];
  ratings: RatingRow[];
  learningEvents: LearningEventRow[];
  priceObservations: PriceObservationRow[];
  modelSnapshots: ModelSnapshotRow[];
  settings: SettingRow[];
  timeEntries: TimeEntryRow[];
  threads: ThreadRow[];
  messages: MessageRow[];
  permissions: PermissionRow[];
  changeRequests: ChangeRequestRow[];
  accounts: SeedAccountLink[];
}

export interface ExistingSeedState {
  /** Компания-покупатель уже существует (ручной бутстрап до появления этого генератора) — не дублировать. */
  buyerCompanyId?: string;
  /** Компания, к которой уже привязан живой supplier@demo.qajet.kz. */
  supplierCompanyId?: string;
  /**
   * БИН этой компании. Если он совпадает с одной из сид-компаний, пересев
   * переиспользует её под своим ключом (профиль и история остаются её), а не
   * под DEMO_SUPPLIER_COMPANY_SEED_KEY — иначе появился бы её дубликат.
   */
  supplierCompanyBin?: string | null | undefined;
  /** email → уже существующий auth/public.users id — не создавать аккаунт и не вставлять users-строку заново. */
  accountsByEmail?: Record<string, string>;
}

export interface GenerateSeedParams {
  seed: number;
  /** ISO-дата "сейчас" — от неё считаются все относительные даты (agents.md §13). */
  referenceDateIso: string;
  /**
   * Повторный прогон против непустой базы (agents.md §13: "один и тот же
   * pnpm db:seed" — не только против пустой): уже существующие компанию
   * покупателя, компанию поставщика демо-логина и аккаунты нужно переиспользовать,
   * а не дублировать второй раз с новыми id.
   */
  existing?: ExistingSeedState;
}

// ---------------------------------------------------------------------------
// Точка входа
// ---------------------------------------------------------------------------

export function generateSeedDataset(params: GenerateSeedParams): SeedDataset {
  const rng = createRng(params.seed);
  const referenceDate = new Date(`${params.referenceDateIso}T00:00:00.000Z`);

  const dataset: SeedDataset = {
    companies: [],
    users: [],
    supplierProfiles: [],
    supplierStats: [],
    requests: [],
    requestItems: [],
    estimates: [],
    prepayments: [],
    rfqs: [],
    quotes: [],
    quoteLines: [],
    plans: [],
    planLines: [],
    planRejections: [],
    orders: [],
    orderStageEvents: [],
    supplierPayouts: [],
    paymentFacts: [],
    documents: [],
    ratings: [],
    learningEvents: [],
    priceObservations: [],
    modelSnapshots: [],
    settings: [],
    timeEntries: [],
    threads: [],
    messages: [],
    permissions: [],
    changeRequests: [],
    accounts: [],
  };

  dataset.settings.push(
    ...OPERATIONAL_SETTINGS,
    // Реквизиты QAJET (agents.md §11.3 «экран подтверждения с реквизитами»)
    // — единственный ключ settings, читаемый и покупателем (RLS-политика
    // settings_select_public_requisites), Document Engine подставляет их
    // в счёт/акт. Демо-значения, не реальное юрлицо.
    {
      key: 'qajet_requisites',
      value: {
        legalName: 'ТОО "QAJET"',
        bin: '241140012345',
        address: 'г. Алматы, Бостандыкский р-н, ул. Розыбакиева 247',
        bankName: 'АО "Kaspi Bank"',
        iban: 'KZ123456789012345678',
        bik: 'CASPKZKA',
        phone: '+7 727 000 00 00',
        email: 'billing@qajet.kz',
      },
    },
  );

  // --- Компании и аккаунты ---
  const existing = params.existing;
  const buyerCompanyId = existing?.buyerCompanyId ?? randomUUID();
  if (!existing?.buyerCompanyId) {
    dataset.companies.push({
      id: buyerCompanyId,
      type: 'buyer',
      name: SEED_BUYER_COMPANY.name,
      bin: SEED_BUYER_COMPANY.bin,
      taxMode: SEED_BUYER_COMPANY.taxMode,
      vatStatus: SEED_BUYER_COMPANY.vatStatus,
      verifiedAt: referenceDate,
      verificationNote: 'Проверено вручную на регистрации в демо-режиме.',
      city: SEED_BUYER_COMPANY.city,
      isActive: true,
    });
  }

  const demoSupplierSeedKey =
    SEED_SUPPLIER_COMPANIES.find(
      ({ supplier }) =>
        existing?.supplierCompanyBin && supplier.bin === existing.supplierCompanyBin,
    )?.seedKey ?? DEMO_SUPPLIER_COMPANY_SEED_KEY;
  const supplierCompanyIdBySeedKey = new Map<string, string>();
  for (const { seedKey, supplier } of SEED_SUPPLIER_COMPANIES) {
    const reusedCompanyId =
      seedKey === demoSupplierSeedKey ? existing?.supplierCompanyId : undefined;
    const companyId = reusedCompanyId ?? randomUUID();
    supplierCompanyIdBySeedKey.set(seedKey, companyId);
    if (!reusedCompanyId) {
      dataset.companies.push({
        id: companyId,
        type: 'supplier',
        name: supplier.name,
        bin: supplier.bin,
        taxMode: supplier.taxMode,
        vatStatus: supplier.vatStatus,
        verifiedAt: supplier.verified ? referenceDate : null,
        verificationNote: supplier.verified ? 'Проверено службой качества QAJET.' : null,
        city: supplier.city,
        isActive: true,
      });
    }
    dataset.supplierProfiles.push({
      id: randomUUID(),
      companyId,
      categories: [...supplier.categories],
      capabilities: [...supplier.capabilities],
      serviceCities: [...new Set([supplier.city, 'Алматы'])],
      minOrderKzt: supplier.minOrderKzt,
      leadTimeDaysDefault: supplier.leadTimeDaysDefault,
      portfolioUrls: [],
      notes: null,
    });
  }

  for (const account of SEED_ACCOUNTS) {
    const existingUserId = existing?.accountsByEmail?.[account.email];
    const userId = existingUserId ?? randomUUID();
    const companyId =
      account.companySeedKey === 'buyer-company'
        ? buyerCompanyId
        : account.companySeedKey === 'supplier-company'
          ? (existing?.supplierCompanyId ??
            supplierCompanyIdBySeedKey.get(demoSupplierSeedKey) ??
            null)
          : null;
    if (!existingUserId) {
      dataset.users.push({
        id: userId,
        companyId,
        email: account.email,
        fullName: account.fullName,
        role: account.role,
        approvalLimitKzt: account.approvalLimitKzt,
        isActive: true,
      });
    }
    dataset.accounts.push({
      seedKey: account.seedKey,
      email: account.email,
      password: account.password,
      fullName: account.fullName,
      userId,
      companyId,
      isQuickLogin: account.isQuickLogin,
      isNew: !existingUserId,
    });
  }

  const conciergeUserId = dataset.accounts.find((a) => a.seedKey === 'demo-concierge')?.userId;
  const buyerUserId = dataset.accounts.find((a) => a.seedKey === 'demo-buyer')?.userId;
  if (!conciergeUserId || !buyerUserId) {
    throw new Error('Сид: не найдены обязательные демо-аккаунты buyer/concierge');
  }

  // --- Растущий пул наблюдений по категориям (наполняется хронологически) ---
  // Ключ — itemKey, НЕ категория: у разных позиций одной категории (например,
  // "Подарок руководителю" за 22 000 и "Welcome-набор" за 8 000) настолько разная
  // базовая цена, что общая на категорию МНК-регрессия ln(price)=a+b·ln(qty) ловит
  // не эффект тиража, а искусственную корреляцию из смешения товаров — и даёт дикие
  // экстраполяции. Пер-товарный пул — то, что описано в agents.md §8B буквально.
  const categoryObservations = new Map<string, LearnObservation[]>();
  const categoryRelativeErrors = new Map<string, number[]>();
  const supplierLeadHistory = new Map<string, SupplierLeadHistoryEntry[]>();
  const supplierOutcomes = new Map<string, OrderOutcome[]>();
  for (const item of SEED_CATALOG) {
    categoryObservations.set(item.itemKey, []);
    categoryRelativeErrors.set(item.itemKey, []);
  }
  for (const { seedKey } of SEED_SUPPLIER_COMPANIES) {
    supplierLeadHistory.set(seedKey, []);
    supplierOutcomes.set(seedKey, []);
  }

  // Средняя базовая ставка поставщиков по категории — нормирует межпоставщический разброс цены.
  const categoryAvgSupplierRate = new Map<SeedCategory, number>();
  for (const c of CATEGORIES) {
    const inCat = SEED_SUPPLIER_COMPANIES.filter((s) => s.supplier.categories.includes(c));
    const avg = inCat.reduce((s, x) => s + x.supplier.baseUnitPriceKzt, 0) / inCat.length;
    categoryAvgSupplierRate.set(c, avg);
  }

  const monthSnapshotPoints: Date[] = [];
  for (let m = 1; m <= 9; m++) {
    monthSnapshotPoints.push(addDays(referenceDate, -HISTORY_SPAN_START_DAYS + m * 30));
  }
  let nextSnapshotIdx = 0;

  const sharedCtx: SharedCtx = {
    buyerCompanyId,
    buyerUserId,
    conciergeUserId,
    supplierCompanyIdBySeedKey,
    categoryObservations,
    categoryRelativeErrors,
    supplierLeadHistory,
    supplierOutcomes,
    categoryAvgSupplierRate,
  };

  // --- 24 закрытых заказа, хронологически от старых к новым ---
  for (let i = 0; i < HISTORY_ORDER_COUNT; i++) {
    const daysAgo =
      HISTORY_SPAN_START_DAYS -
      Math.round(
        (i * (HISTORY_SPAN_START_DAYS - HISTORY_SPAN_END_DAYS)) / (HISTORY_ORDER_COUNT - 1),
      );
    const targetClosedAt = addDays(referenceDate, -daysAgo);
    /** 0 → максимальный синтетический шум (мало данных), 1 → минимальный (богатая история) — отсюда падающий MAPE. */
    const progress = i / (HISTORY_ORDER_COUNT - 1);

    buildOrder({
      dataset,
      rng,
      progress,
      targetState: 'closed',
      targetAt: targetClosedAt,
      ctx: sharedCtx,
    });

    while (nextSnapshotIdx < monthSnapshotPoints.length) {
      const point = monthSnapshotPoints[nextSnapshotIdx];
      if (point === undefined || targetClosedAt < point) break;
      pushModelSnapshots({
        dataset,
        now: point,
        categoryObservations,
        categoryRelativeErrors,
        supplierLeadHistory,
        supplierOutcomes,
      });
      nextSnapshotIdx++;
    }
  }
  while (nextSnapshotIdx < monthSnapshotPoints.length) {
    const point = monthSnapshotPoints[nextSnapshotIdx];
    if (point !== undefined) {
      pushModelSnapshots({
        dataset,
        now: point,
        categoryObservations,
        categoryRelativeErrors,
        supplierLeadHistory,
        supplierOutcomes,
      });
    }
    nextSnapshotIdx++;
  }

  // --- 1 заказ на каждой оставшейся стадии жизненного цикла ---
  const lifecycleStates: OrderState[] = [
    'draft',
    'estimated',
    'prepaid',
    'rfq_sent',
    'plan_proposed',
    'plan_approved',
    'suppliers_paid',
    'in_production',
    'shipped',
    'delivered',
    'accepted',
    'awaiting_internal_approval',
    'on_hold',
    'cancelled',
    'disputed',
  ];
  for (const state of lifecycleStates) {
    buildOrder({
      dataset,
      rng,
      progress: 1,
      targetState: state,
      targetAt: addDays(referenceDate, -randInt(rng, 1, 12)),
      ctx: sharedCtx,
    });
  }

  // --- Спецзаказ демо-сцены: quotes_received, 6 позиций, 5 КП, 2 с пропусками, 1 с невыполнимым сроком ---
  buildQuotesReceivedDemoOrder({ dataset, rng, referenceDate, ctx: sharedCtx });

  // --- Треды/сообщения/внутренние заметки по всем заказам ---
  pushCommunications({ dataset, rng, buyerUserId, conciergeUserId });

  // --- Доступы сотрудников компании-покупателя (§10 «Команда и доступы») ---
  // Лимит согласования живёт колонкой `users.approval_limit_kzt`; здесь —
  // именно права, которые владелец компании выдаёт и отзывает поимённо.
  for (const account of dataset.accounts) {
    if (account.companyId !== buyerCompanyId) continue;
    const isOwner = account.seedKey === 'demo-buyer';
    dataset.permissions.push(
      {
        userId: account.userId,
        key: 'can_create_request',
        value: true,
        createdAt: referenceDate,
        updatedAt: referenceDate,
      },
      {
        userId: account.userId,
        key: 'can_approve_plan',
        value: true,
        createdAt: referenceDate,
        updatedAt: referenceDate,
      },
      {
        userId: account.userId,
        key: 'can_manage_team',
        value: isOwner,
        createdAt: referenceDate,
        updatedAt: referenceDate,
      },
    );
  }

  // --- Запрос на изменение утверждённого плана (§15: «изменение
  // утверждённого плана создаёт новую версию, а не правит заказ») ---
  // Демонстрируется на закрытом заказе: покупатель попросил увеличить тираж
  // уже после утверждения, из-за чего появилась новая версия плана.
  const changeRequestOrder = dataset.orders.find((o) => o.state === 'closed');
  if (changeRequestOrder?.approvedPlanId) {
    const at = changeRequestOrder.closedAt ?? referenceDate;
    dataset.changeRequests.push({
      orderId: changeRequestOrder.id as string,
      proposedPlanId: changeRequestOrder.approvedPlanId as string,
      initiatorUserId: buyerUserId,
      diff: {
        reason: 'Увеличение тиража после утверждения плана',
        changes: [{ field: 'qty', note: 'тираж увеличен клиентом до отгрузки' }],
      },
      status: 'accepted',
      createdAt: at,
      updatedAt: at,
    });
  }

  // --- supplier_stats из накопленных исходов ---
  for (const { seedKey } of SEED_SUPPLIER_COMPANIES) {
    const outcomes = supplierOutcomes.get(seedKey) ?? [];
    const companyId = supplierCompanyIdBySeedKey.get(seedKey);
    if (!companyId) continue;
    const onTime = outcomes.filter((o) => o.wasOnTime).length;
    const disputed = outcomes.filter((o) => o.hadDispute).length;
    const scored = outcomes.filter((o) => o.buyerScore !== null).map((o) => o.buyerScore as number);
    dataset.supplierStats.push({
      id: randomUUID(),
      companyId,
      ordersTotal: outcomes.length,
      ordersOnTime: onTime,
      ordersDisputed: disputed,
      avgBuyerScore:
        scored.length > 0 ? Math.round(scored.reduce((s, v) => s + v, 0) / scored.length) : null,
      rfqSent: outcomes.length,
      rfqAnswered: outcomes.length,
      medianResponseHours: randInt(rng, 3, 30),
      leadTimeMultiplier: null,
    });
  }

  return dataset;
}

// ---------------------------------------------------------------------------
// Построение одного заказа — переиспользуется и историей, и жизненным циклом
// ---------------------------------------------------------------------------

interface SharedCtx {
  buyerCompanyId: string;
  buyerUserId: string;
  conciergeUserId: string;
  supplierCompanyIdBySeedKey: Map<string, string>;
  categoryObservations: Map<string, LearnObservation[]>;
  categoryRelativeErrors: Map<string, number[]>;
  supplierLeadHistory: Map<string, SupplierLeadHistoryEntry[]>;
  supplierOutcomes: Map<string, OrderOutcome[]>;
  categoryAvgSupplierRate: Map<SeedCategory, number>;
}

interface BuildOrderParams {
  dataset: SeedDataset;
  rng: () => number;
  /** 0..1 — как далеко в "обучении" мы находимся; управляет шумом синтетической цены. */
  progress: number;
  targetState: OrderState;
  targetAt: Date;
  ctx: SharedCtx;
}

/**
 * Скидка за тираж — реальная бизнес-логика (агентс.md §8B: "модель эффекта
 * тиража"), а заодно даёт fitLogLogRegression настоящую, а не шумовую связь
 * ln(price)=a+b·ln(qty) для обучения: без неё регрессия ловит только шум
 * и не сходится к стабильной модели, сколько исторических точек ни дай.
 */
function qtyDiscountFactor(item: CatalogItem, qty: number): number {
  const typicalQty = (item.qtyMin + item.qtyMax) / 2;
  return (qty / typicalQty) ** -0.15;
}

function pickCategory(rng: () => number): SeedCategory {
  const cat = CATEGORIES[Math.floor(rng() * CATEGORIES.length)];
  if (cat === undefined) throw new Error('unreachable');
  return cat;
}

/**
 * Переписки, доступы и запросы на изменение плана — отдельным проходом по
 * уже построенным заказам, а не внутри `buildOrder`: тот выходит через
 * несколько ранних `return` на разных целевых стадиях, и один общий хвост
 * в нём недостижим. Схема (`packages/db/src/schema/communication.ts`) и её
 * RLS существовали с фазы 1, но сид никогда сюда не писал — из-за чего
 * экран сообщений покупателя стоял на выдуманных данных.
 */
function pushCommunications(p: {
  dataset: SeedDataset;
  rng: () => number;
  buyerUserId: string;
  conciergeUserId: string;
}): void {
  const { dataset, rng, buyerUserId, conciergeUserId } = p;

  const requestById = new Map(dataset.requests.map((r) => [r.id as string, r]));
  const eventsByOrder = new Map<string, OrderStageEventRow[]>();
  for (const event of dataset.orderStageEvents) {
    const list = eventsByOrder.get(event.orderId as string) ?? [];
    list.push(event);
    eventsByOrder.set(event.orderId as string, list);
  }

  for (const order of dataset.orders) {
    const orderId = order.id as string;
    const request = requestById.get(order.requestId as string);
    if (!request) continue;
    const events = (eventsByOrder.get(orderId) ?? [])
      .slice()
      .sort((a, b) => (a.at as Date).getTime() - (b.at as Date).getTime());
    const firstAt = (events[0]?.at as Date | undefined) ?? new Date();
    const lastAt = (events[events.length - 1]?.at as Date | undefined) ?? firstAt;
    if (order.state === 'draft') continue;

    const buyerThreadId = randomUUID();
    dataset.threads.push({
      id: buyerThreadId,
      orderId,
      requestId: order.requestId,
      kind: 'buyer',
      supplierCompanyId: null,
      createdAt: firstAt,
      updatedAt: lastAt,
    });
    const openedAt = addDays(firstAt, 1);
    dataset.messages.push(
      {
        threadId: buyerThreadId,
        authorUserId: conciergeUserId,
        body: `Взяли «${request.title}» в работу. Считаю оценку по истории закупок и вернусь с предоплатным счётом.`,
        attachments: [],
        createdAt: firstAt,
        updatedAt: firstAt,
      },
      {
        threadId: buyerThreadId,
        authorUserId: buyerUserId,
        body: 'Спасибо. Срок жёсткий — если не проходим, скажите сразу, лучше сократим тираж.',
        attachments: [],
        createdAt: openedAt,
        updatedAt: openedAt,
      },
    );
    if (order.state === 'closed') {
      dataset.messages.push({
        threadId: buyerThreadId,
        authorUserId: conciergeUserId,
        body: 'Заказ закрыт, акт и сверка в документах заказа. Спасибо за работу.',
        attachments: [],
        createdAt: lastAt,
        updatedAt: lastAt,
      });
    }

    // Внутренние заметки (§3.5, §10 «Консьерж → внутренние заметки») — kind
    // 'internal', RLS физически закрывает их и от покупателя, и от поставщика.
    if (rng() < 0.35) {
      const internalThreadId = randomUUID();
      dataset.threads.push({
        id: internalThreadId,
        orderId,
        requestId: order.requestId,
        kind: 'internal',
        supplierCompanyId: null,
        createdAt: firstAt,
        updatedAt: firstAt,
      });
      dataset.messages.push({
        threadId: internalThreadId,
        authorUserId: conciergeUserId,
        body: 'Заметка: у клиента жёсткая приёмка по качеству печати — брать поставщиков с подтверждённым техпроцессом, не по минимальной цене.',
        attachments: [],
        createdAt: firstAt,
        updatedAt: firstAt,
      });
    }
  }
}

function buildOrder(p: BuildOrderParams): void {
  const { dataset, rng, progress, targetState, targetAt, ctx } = p;
  const {
    buyerCompanyId,
    buyerUserId,
    conciergeUserId,
    supplierCompanyIdBySeedKey,
    categoryObservations,
    categoryRelativeErrors,
    supplierLeadHistory,
    supplierOutcomes,
    categoryAvgSupplierRate,
  } = ctx;

  const category = pickCategory(rng);
  const catalog = catalogInCategory(category);
  const itemCount = Math.min(catalog.length, randInt(rng, 1, 2));
  const items = pickMany(rng, catalog, itemCount);

  const stageDepth = CANONICAL_ORDER_STATES.includes(targetState as CanonicalState)
    ? CANONICAL_ORDER_STATES.indexOf(targetState as CanonicalState)
    : CANONICAL_ORDER_STATES.indexOf(
        EXCEPTION_BRANCHES[targetState as keyof typeof EXCEPTION_BRANCHES] ?? 'plan_approved',
      );
  const cycleDays = Math.max(6, stageDepth * 3 + randInt(rng, 4, 10));
  const clock = new Clock(addDays(targetAt, -cycleDays));

  const requestId = randomUUID();
  const requestItems: { id: string; item: CatalogItem; qty: number }[] = items.map((item) => ({
    id: randomUUID(),
    item,
    qty: randInt(rng, item.qtyMin, item.qtyMax),
  }));
  const budgetKzt = requestItems.reduce((s, ri) => s + ri.item.baseUnitPriceKzt * ri.qty, 0);
  const deadlineDate = addDays(clock.now(), cycleDays + randInt(rng, 5, 15));
  const createdAt = clock.now();

  dataset.requests.push({
    id: requestId,
    buyerCompanyId,
    createdBy: buyerUserId,
    title: requestItems.map((ri) => ri.item.name).join(', '),
    rawText: `Нужно: ${requestItems.map((ri) => `${ri.item.name} — ${ri.qty} ${ri.item.unit}`).join('; ')}. Дедлайн ${isoDateOnly(deadlineDate)}.`,
    deadlineDate: isoDateOnly(deadlineDate),
    budgetKzt: roundKzt(budgetKzt),
    deliveryAddress: 'г. Алматы, офис заказчика',
    city: 'Алматы',
    status: 'draft',
    extractionConfidence: 0.8 + rng() * 0.18,
    createdAt,
    updatedAt: createdAt,
  });
  const requestRow = dataset.requests[dataset.requests.length - 1] as RequestRow;

  for (const ri of requestItems) {
    dataset.requestItems.push({
      id: ri.id,
      requestId,
      name: ri.item.name,
      category: ri.item.category,
      qty: ri.qty,
      unit: ri.item.unit,
      specs: {},
      requiredCapabilities: [...ri.item.requiredCapabilities],
      needsClarification: false,
      clarificationReason: null,
    });
  }

  // Заглушка-план сразу же — orders.approvedPlanId not null, а реальный план
  // появится только после combine() на настоящих КП (см. комментарий у файла).
  const placeholderPlanId = randomUUID();
  dataset.plans.push({
    id: placeholderPlanId,
    requestId,
    version: 1,
    kind: 'manual',
    totalSupplierKzt: 0,
    deliveryKzt: 0,
    commissionKzt: 0,
    commissionBase: 'supplier_ex_delivery',
    taxEffectKzt: 0,
    totalKzt: 0,
    etaDate: null,
    slackDays: null,
    supplierCount: 0,
    explanation: {
      decomposition: [],
      notes: ['Черновик — реальный план собирается после получения КП.'],
      comparedOffersCount: 0,
      rejectedOffersCount: 0,
    } satisfies Explanation & { comparedOffersCount: number; rejectedOffersCount: number },
    status: 'draft',
    createdAt,
  });

  const orderId = randomUUID();
  dataset.orders.push({
    id: orderId,
    requestId,
    approvedPlanId: placeholderPlanId,
    state: 'draft',
    conciergeUserId,
    acceptedAt: null,
    closedAt: null,
    finalCostKzt: null,
    settlement: null,
    settlementAmountKzt: null,
  });
  const orderRow = dataset.orders[dataset.orders.length - 1] as OrderRow;

  let currentState: OrderState = 'draft';
  const advance = (to: OrderState, at: Date, actorUserId: string): void => {
    dataset.orderStageEvents.push({
      id: randomUUID(),
      orderId,
      fromState: currentState,
      toState: to,
      actorUserId,
      at,
    });
    // Учёт времени (§9) пишется тем же событием, что и переход, и только для
    // консьержа — RLS `time_entries_insert_own` пускает вставку лишь
    // staff-ролям, а покупатель, утверждая план, времени QAJET не тратит.
    // Записывается стадия, которую ПОКИДАЕМ, — та же семантика, что у живого
    // автотаймера (apps/web/app/lib/autotimer.ts).
    if (actorUserId === conciergeUserId) {
      const stage = TIME_ENTRY_STAGE_BY_STATE[currentState];
      const baseMinutes = ACTIVE_MINUTES_BY_TIME_ENTRY_STAGE[stage];
      const learned = 1 - ACTIVE_TIME_LEARNING_DROP * progress;
      const jitter = 0.8 + rng() * 0.4;
      dataset.timeEntries.push({
        orderId,
        userId: conciergeUserId,
        stage,
        seconds: Math.round(baseMinutes * 60 * learned * jitter),
        source: 'auto',
        createdAt: at,
        updatedAt: at,
      });
    }
    currentState = to;
    orderRow.state = to;
  };

  if (targetState === 'draft') return;

  requestRow.status = 'submitted';

  // --- Оценка (agents.md §8B) — через реальный engine.estimate() с накопленным пулом ---
  let totalP50 = 0;
  let totalP80 = 0;
  let maxMargin = 0;
  const nSamplesTotal = requestItems.reduce(
    (s, ri) => s + (categoryObservations.get(ri.item.itemKey)?.length ?? 0),
    0,
  );
  for (const ri of requestItems) {
    const pastRelativeErrors = categoryRelativeErrors.get(ri.item.itemKey);
    const est = engineEstimate({
      qty: ri.qty,
      observations: categoryObservations.get(ri.item.itemKey) ?? [],
      baseRateKzt: ri.item.baseUnitPriceKzt,
      ...(pastRelativeErrors ? { pastRelativeErrors } : {}),
    });
    totalP50 += est.p50Kzt;
    totalP80 += est.p80Kzt;
    maxMargin = Math.max(maxMargin, est.marginPct);
  }
  const estimateAt = clock.advance(0);
  dataset.estimates.push({
    id: randomUUID(),
    requestId,
    p50Kzt: roundKzt(totalP50),
    p80Kzt: roundKzt(totalP80),
    marginPct: maxMargin,
    basis: { nSamples: nSamplesTotal, method: 'engine.estimate log-log + Bayesian shrinkage' },
    createdAt: estimateAt,
  });
  requestRow.status = 'estimated';
  advance('estimated', estimateAt, conciergeUserId);
  if (targetState === 'estimated') return;

  // --- Предоплата ---
  const prepayAt = clock.advance(1);
  const prepaymentAmountKzt = roundKzt(totalP80);
  dataset.prepayments.push({
    id: randomUUID(),
    requestId,
    amountKzt: prepaymentAmountKzt,
    invoiceNo: `PRE-${requestId.slice(0, 8)}`,
    status: 'paid',
    paidAt: prepayAt,
    proofUrl: null,
    createdAt: prepayAt,
  });
  dataset.paymentFacts.push({
    id: randomUUID(),
    orderId,
    supplierCompanyId: null,
    direction: 'inbound',
    kind: 'prepayment',
    status: 'confirmed',
    amountKzt: prepaymentAmountKzt,
    reference: `SEED-PRE-${requestId.slice(0, 8)}`,
    proofUrl: null,
    occurredAt: prepayAt,
    confirmedBy: conciergeUserId,
    idempotencyKey: `seed:prepayment:${orderId}`,
  });
  advance('prepaid', prepayAt, conciergeUserId);
  if (targetState === 'prepaid') return;

  // --- RFQ ---
  const covers = (
    sc: (typeof SEED_SUPPLIER_COMPANIES)[number],
    ri: (typeof requestItems)[number],
  ) => ri.item.requiredCapabilities.every((c) => sc.supplier.capabilities.includes(c));
  const candidates = SEED_SUPPLIER_COMPANIES.filter(
    (s) => s.supplier.categories.includes(category) && requestItems.some((ri) => covers(s, ri)),
  );
  const chosenSuppliers = pickMany(
    rng,
    candidates,
    Math.min(candidates.length, randInt(rng, 2, 4)),
  );
  // combine() требует хотя бы одно допустимое предложение НА КАЖДУЮ позицию — pickMany выше
  // гарантирует только пересечение по категории, а не полное покрытие всех позиций заказа.
  for (const ri of requestItems) {
    if (chosenSuppliers.some((sc) => covers(sc, ri))) continue;
    const backup = SEED_SUPPLIER_COMPANIES.find(
      (sc) => covers(sc, ri) && !chosenSuppliers.includes(sc),
    );
    if (backup) chosenSuppliers.push(backup);
  }
  const rfqSentAt = clock.advance(1);
  const respondBy = addDays(rfqSentAt, 5);
  const rfqIdBySupplier = new Map<string, string>();
  for (const [idx, sc] of chosenSuppliers.entries()) {
    const rfqId = randomUUID();
    rfqIdBySupplier.set(sc.seedKey, rfqId);
    dataset.rfqs.push({
      id: rfqId,
      requestId,
      supplierCompanyId: supplierCompanyIdBySeedKey.get(sc.seedKey) ?? '',
      token: randomUUID(),
      sentAt: rfqSentAt,
      respondBy,
      status: 'quoted',
      assignedSupplierUserId: null,
      selectionReason: { reason: 'category_and_capability_match', category },
      isExploration: idx === chosenSuppliers.length - 1 && rng() < 0.3,
    });
  }
  advance('rfq_sent', rfqSentAt, conciergeUserId);
  if (targetState === 'rfq_sent') return;
  if (targetState === 'cancelled') {
    advance('cancelled', addDays(rfqSentAt, 1), buyerUserId);
    requestRow.status = 'closed';
    return;
  }

  // --- Квоты и строки КП ---
  const offersByItem = new Map<string, EngineOffer[]>();
  let quoteMaxAt = rfqSentAt;
  for (const sc of chosenSuppliers) {
    const rfqId = rfqIdBySupplier.get(sc.seedKey);
    if (!rfqId) continue;
    const submittedAt = addDays(rfqSentAt, randInt(rng, 1, 4));
    if (submittedAt > quoteMaxAt) quoteMaxAt = submittedAt;
    const validUntil = addDays(submittedAt, 14);
    const quoteId = randomUUID();
    dataset.quotes.push({
      id: quoteId,
      rfqId,
      submittedAt,
      validUntil: isoDateOnly(validUntil),
      currency: 'KZT',
      notes: null,
      source: 'form',
      fileUrl: null,
    });

    const supplierId = supplierCompanyIdBySeedKey.get(sc.seedKey) ?? '';
    const avgRate = categoryAvgSupplierRate.get(category) ?? sc.supplier.baseUnitPriceKzt;
    const priceFactor = (sc.supplier.baseUnitPriceKzt / avgRate) * (0.9 + rng() * 0.2);
    /** Синтетический разброс сужается с прогрессом истории — реалистичное, а не подрисованное сближение факта с оценкой. */
    const noiseSpread = 0.22 - progress * 0.14;
    const bundleRule =
      rng() < 0.4
        ? {
            thresholdKzt: roundKzt(sc.supplier.baseUnitPriceKzt * 40),
            discountPct: randInt(rng, 5, 15),
          }
        : null;

    for (const ri of requestItems) {
      if (!ri.item.requiredCapabilities.every((c) => sc.supplier.capabilities.includes(c)))
        continue;
      const unitPriceKzt = roundKzt(
        ri.item.baseUnitPriceKzt *
          priceFactor *
          qtyDiscountFactor(ri.item, ri.qty) *
          (1 + (rng() * 2 - 1) * noiseSpread),
      );
      const declaredLeadDays = Math.max(
        1,
        Math.round(sc.supplier.leadTimeDaysDefault * (0.85 + rng() * 0.3)),
      );
      const reliability = calculateSupplierReliability(supplierLeadHistory.get(sc.seedKey) ?? []);
      const predicted = predictAfterQuote({
        declaredLeadDays,
        supplierHistory: supplierLeadHistory.get(sc.seedKey) ?? [],
        logisticsBufferDays:
          sc.supplier.city === 'Алматы'
            ? LOGISTICS_BUFFER_ALMATY_DAYS
            : LOGISTICS_BUFFER_INTERCITY_DAYS,
      });
      const setupFeeKzt = rng() < 0.5 ? randInt(rng, 0, 15_000) : 0;
      const quoteLineId = randomUUID();
      dataset.quoteLines.push({
        id: quoteLineId,
        quoteId,
        requestItemId: ri.id,
        unitPriceKzt,
        minQty: null,
        setupFeeKzt,
        leadTimeDays: declaredLeadDays,
        bundleRule,
        capabilityConfirmed: true,
        fieldFlags: {},
      });
      const offer: EngineOffer = {
        id: quoteLineId,
        requestItemId: ri.id,
        supplierId,
        unitPriceKzt,
        setupFeeKzt,
        predictedLeadDays: predicted.predictedDays,
        minQty: null,
        orderMultiple: null,
        bundleRule,
        capabilityConfirmed: true,
        hasOpenFieldFlags: false,
        validUntil: isoDateOnly(validUntil),
        supplierTaxMode: sc.supplier.taxMode,
        supplierDeliveryKzt:
          sc.supplier.city === 'Алматы'
            ? LOGISTICS_DELIVERY_LOCAL_KZT
            : LOGISTICS_DELIVERY_INTERCITY_KZT,
      };
      const list = offersByItem.get(ri.id);
      if (list) list.push(offer);
      else offersByItem.set(ri.id, [offer]);

      dataset.priceObservations.push({
        id: randomUUID(),
        category,
        itemKey: ri.item.itemKey,
        qty: ri.qty,
        unitPriceKzt,
        supplierCompanyId: supplierId,
        observedAt: submittedAt,
      });
      categoryObservations.get(ri.item.itemKey)?.push({ qty: ri.qty, unitPriceKzt });
      const leadHistory = supplierLeadHistory.get(sc.seedKey);
      const actualLeadDays = Math.max(
        1,
        Math.round(declaredLeadDays * reliability.kShrunk * (0.9 + rng() * 0.2)),
      );
      leadHistory?.push({ declaredDays: declaredLeadDays, actualDays: actualLeadDays });
    }
  }
  advance('quotes_received', quoteMaxAt, conciergeUserId);

  const allOffers = [...offersByItem.values()].flat();
  if (allOffers.length === 0) return;

  const combineResult: CombineResult = combine({
    items: requestItems.map((ri) => ({ id: ri.id, qty: ri.qty })),
    offers: allOffers,
    deadlineDate: isoDateOnly(deadlineDate),
    today: isoDateOnly(quoteMaxAt),
    commissionRatePct: COMMISSION_RATE_PCT,
    citRatePct: CIT_RATE_PCT,
  });

  for (const rejection of combineResult.rejections) {
    dataset.planRejections.push({
      id: randomUUID(),
      requestId,
      planContext: 'seed_history',
      quoteLineId: rejection.offerId,
      reasonCode: rejection.code,
      reasonHuman: rejection.reasonHuman,
    });
  }

  const chosenPlan =
    combineResult.plans.find((pl) => pl.kind === 'recommended') ?? combineResult.plans[0];
  if (!chosenPlan) return;

  const planProposedAt = clock.advance(1);
  const realPlanId = randomUUID();
  const finalPlanStatus =
    targetState === 'plan_proposed' || targetState === 'awaiting_internal_approval'
      ? 'proposed'
      : 'approved';
  dataset.plans.push({
    id: realPlanId,
    requestId,
    version: 2,
    kind: chosenPlan.kind,
    totalSupplierKzt: chosenPlan.totalSupplierKzt,
    deliveryKzt: chosenPlan.deliveryKzt,
    commissionKzt: chosenPlan.commissionKzt,
    commissionBase: chosenPlan.commissionBase,
    taxEffectKzt: chosenPlan.taxEffectKzt,
    totalKzt: chosenPlan.totalKzt,
    etaDate: isoDateOnly(addDays(planProposedAt, chosenPlan.etaDays)),
    slackDays: chosenPlan.slackDays,
    supplierCount: chosenPlan.supplierCount,
    explanation: chosenPlan.explanation,
    status: finalPlanStatus,
    createdAt: planProposedAt,
  });
  orderRow.approvedPlanId = realPlanId;
  const placeholder = dataset.plans.find((pl) => pl.id === placeholderPlanId);
  if (placeholder) placeholder.status = 'superseded';

  const lineCommissions = allocateCommission(
    chosenPlan.totalSupplierKzt,
    COMMISSION_RATE_PCT,
    chosenPlan.lines.map((line) => line.lineTotalKzt),
  );
  for (const [index, line] of chosenPlan.lines.entries()) {
    dataset.planLines.push({
      id: randomUUID(),
      planId: realPlanId,
      requestItemId: line.requestItemId,
      supplierCompanyId: line.supplierId,
      quoteLineId: line.offerId,
      qty: requestItems.find((ri) => ri.id === line.requestItemId)?.qty ?? 0,
      lineTotalKzt: line.lineTotalKzt,
      commissionPct: COMMISSION_RATE_PCT,
      commissionKzt: lineCommissions[index] ?? 0,
    });
  }

  advance('plan_proposed', planProposedAt, conciergeUserId);
  if (targetState === 'plan_proposed') return;
  if (targetState === 'awaiting_internal_approval') {
    advance('awaiting_internal_approval', addDays(planProposedAt, 1), buyerUserId);
    return;
  }

  const planApprovedAt = clock.advance(1);
  advance('plan_approved', planApprovedAt, buyerUserId);
  if (targetState === 'plan_approved') return;
  if (targetState === 'on_hold') {
    advance('on_hold', addDays(planApprovedAt, 1), conciergeUserId);
    return;
  }

  const involvedSuppliers = [...new Set(chosenPlan.lines.map((l) => l.supplierId))];
  const suppliersPaidAt = clock.advance(1);
  for (const supplierId of involvedSuppliers) {
    const lines = chosenPlan.lines.filter((l) => l.supplierId === supplierId);
    const supplierAmountKzt = roundKzt(lines.reduce((s, l) => s + l.lineTotalKzt, 0));
    dataset.paymentFacts.push({
      id: randomUUID(),
      orderId,
      supplierCompanyId: supplierId,
      direction: 'outbound',
      kind: 'supplier_payout',
      status: 'confirmed',
      amountKzt: supplierAmountKzt,
      reference: `SEED-PAYOUT-${orderId.slice(0, 8)}-${supplierId.slice(0, 8)}`,
      proofUrl: null,
      occurredAt: suppliersPaidAt,
      confirmedBy: conciergeUserId,
      idempotencyKey: `seed:supplier-payout:${orderId}:${supplierId}`,
    });
    dataset.supplierPayouts.push({
      id: randomUUID(),
      orderId,
      supplierCompanyId: supplierId,
      amountKzt: supplierAmountKzt,
      status: 'paid',
      paidAt: suppliersPaidAt,
      docUrl: null,
    });
  }
  advance('suppliers_paid', suppliersPaidAt, conciergeUserId);
  if (targetState === 'suppliers_paid') return;

  const inProductionAt = clock.advance(1);
  advance('in_production', inProductionAt, conciergeUserId);
  if (targetState === 'in_production') return;

  const producedDays = Math.max(2, Math.round(chosenPlan.etaDays * 0.7));
  const shippedAt = clock.advance(producedDays);
  advance('shipped', shippedAt, conciergeUserId);
  if (targetState === 'shipped') return;

  const deliveredAt = clock.advance(chosenPlan.slackDays >= 0 ? 2 : 4);
  advance('delivered', deliveredAt, conciergeUserId);
  if (targetState === 'delivered' || targetState === 'disputed') {
    if (targetState === 'disputed') {
      recordRatings({
        dataset,
        orderId,
        involvedSuppliers,
        supplierCompanyIdBySeedKey,
        supplierOutcomes,
        forceDispute: true,
      });
      advance('disputed', addDays(deliveredAt, 1), buyerUserId);
    }
    return;
  }

  const acceptedAt = clock.advance(1);
  orderRow.acceptedAt = acceptedAt;
  advance('accepted', acceptedAt, buyerUserId);
  if (targetState === 'accepted') {
    recordRatings({
      dataset,
      orderId,
      involvedSuppliers,
      supplierCompanyIdBySeedKey,
      supplierOutcomes,
      forceDispute: false,
    });
    return;
  }

  const closedAt = clock.advance(1);
  const settlement =
    prepaymentAmountKzt > chosenPlan.totalKzt
      ? 'refund'
      : prepaymentAmountKzt < chosenPlan.totalKzt
        ? 'surcharge'
        : 'exact';
  const settlementMagnitudeKzt =
    settlement === 'exact' ? 0 : Math.abs(chosenPlan.totalKzt - prepaymentAmountKzt);
  const settlementAmountKzt =
    settlement === 'refund' ? -settlementMagnitudeKzt : settlementMagnitudeKzt;
  const finalCostKzt = chosenPlan.totalKzt;
  if (settlement !== 'exact') {
    dataset.paymentFacts.push({
      id: randomUUID(),
      orderId,
      supplierCompanyId: null,
      direction: settlement === 'refund' ? 'outbound' : 'inbound',
      kind: settlement,
      status: 'confirmed',
      amountKzt: settlementMagnitudeKzt,
      reference: `SEED-${settlement.toUpperCase()}-${orderId.slice(0, 8)}`,
      proofUrl: null,
      occurredAt: closedAt,
      confirmedBy: conciergeUserId,
      idempotencyKey: `seed:settlement:${orderId}:${settlement}`,
    });
  }
  orderRow.closedAt = closedAt;
  orderRow.finalCostKzt = finalCostKzt;
  orderRow.settlement = settlement;
  orderRow.settlementAmountKzt = settlementAmountKzt;
  advance('closed', closedAt, buyerUserId);
  requestRow.status = 'closed';

  // Стадия `closing` (§9) не появляется из переходов: приёмку и закрытие
  // совершает покупатель, а закрывающую работу — сверку и акт — делает
  // консьерж, и делает её именно здесь. Пишем её явно, иначе стадия
  // никогда не попала бы в учёт времени, хотя работа реальная.
  dataset.timeEntries.push({
    orderId,
    userId: conciergeUserId,
    stage: 'closing',
    seconds: Math.round(
      ACTIVE_MINUTES_BY_TIME_ENTRY_STAGE.closing *
        60 *
        (1 - ACTIVE_TIME_LEARNING_DROP * progress) *
        (0.8 + rng() * 0.4),
    ),
    source: 'auto',
    createdAt: closedAt,
    updatedAt: closedAt,
  });

  recordRatings({
    dataset,
    orderId,
    involvedSuppliers,
    supplierCompanyIdBySeedKey,
    supplierOutcomes,
    forceDispute: false,
  });

  dataset.documents.push(
    {
      id: randomUUID(),
      orderId,
      stage: 'prepaid',
      type: 'prepay_invoice',
      url: `/documents/${orderId}?type=prepay_invoice`,
      meta: {
        invoiceNo: `PRE-${orderId.slice(0, 8)}`,
        amountKzt: prepaymentAmountKzt,
        buyerCompany: { name: SEED_BUYER_COMPANY.name, bin: SEED_BUYER_COMPANY.bin },
        qajetRequisites: QAJET_SEED_REQUISITES,
        issuedAt: closedAt.toISOString(),
      },
    },
    {
      id: randomUUID(),
      orderId,
      stage: 'closed',
      type: 'act',
      url: `/documents/${orderId}?type=act`,
      meta: {
        actNo: `ACT-${orderId.slice(0, 8)}`,
        buyerCompany: { name: SEED_BUYER_COMPANY.name, bin: SEED_BUYER_COMPANY.bin },
        qajetRequisites: QAJET_SEED_REQUISITES,
        planTotalKzt: chosenPlan.totalKzt,
        settlement,
        settlementAmountKzt,
        finalCostKzt,
        items: requestItems.map((ri) => ({ name: ri.item.name, qty: ri.qty, unit: ri.item.unit })),
        closedAt: closedAt.toISOString(),
      },
    },
  );
  dataset.learningEvents.push({
    id: randomUUID(),
    type: 'order_closed',
    payload: { orderId, requestId, category, totalKzt: finalCostKzt },
    processedAt: closedAt,
    createdAt: closedAt,
  });
  // Точность оценки меряется против стоимости ТОВАРА в собранном плане, а не против
  // totalKzt: p50Kzt (agents.md §8B) — это оценка ДО КП, она никогда не включала
  // доставку/setup fee/комиссию, поэтому сравнивать нужно с тем же самым — суммой
  // строк плана, а не с полной суммой заказа, иначе категория с высоким setup fee
  // относительно цены товара (например, корпоративные подарки) даёт систематическую,
  // никогда не убывающую ошибку, которая на самом деле не про качество модели.
  const actualProductCostKzt = chosenPlan.lines.reduce((s, l) => s + l.lineTotalKzt, 0);
  const p50 =
    dataset.estimates.find((e) => e.requestId === requestId)?.p50Kzt ?? actualProductCostKzt;
  const relError = (actualProductCostKzt - p50) / p50;
  for (const ri of requestItems) {
    const errors = categoryRelativeErrors.get(ri.item.itemKey);
    if (!errors) continue;
    errors.push(relError);
    // Скользящее окно: P80 по всей истории с начала времён никогда не "улучшится" —
    // старый шум навсегда тянет квантиль вверх. Recalibrate реально показывает
    // прогресс модели только на недавней истории, как и было бы в проде на кроне.
    if (errors.length > RELATIVE_ERROR_WINDOW)
      errors.splice(0, errors.length - RELATIVE_ERROR_WINDOW);
  }
}

function recordRatings(args: {
  dataset: SeedDataset;
  orderId: string;
  involvedSuppliers: string[];
  supplierCompanyIdBySeedKey: Map<string, string>;
  supplierOutcomes: Map<string, OrderOutcome[]>;
  forceDispute: boolean;
}): void {
  const {
    dataset,
    orderId,
    involvedSuppliers,
    supplierCompanyIdBySeedKey,
    supplierOutcomes,
    forceDispute,
  } = args;
  for (const supplierId of involvedSuppliers) {
    const seedKey = SEED_SUPPLIER_COMPANIES.find(
      (s) => supplierCompanyIdBySeedKey.get(s.seedKey) === supplierId,
    )?.seedKey;
    const hadDispute = forceDispute;
    const wasOnTime = !forceDispute;
    const buyerScore = hadDispute ? 2 : 4;
    dataset.ratings.push({
      id: randomUUID(),
      orderId,
      supplierCompanyId: supplierId,
      buyerScore1To5: buyerScore,
      wasOnTime,
      hadDispute,
      comment: null,
    });
    if (seedKey) supplierOutcomes.get(seedKey)?.push({ wasOnTime, hadDispute, buyerScore });
  }
}

// ---------------------------------------------------------------------------
// Снимки модели — реальный recalibrate() на накопленном к дате пуле
// ---------------------------------------------------------------------------

function pushModelSnapshots(args: {
  dataset: SeedDataset;
  now: Date;
  categoryObservations: Map<string, LearnObservation[]>;
  categoryRelativeErrors: Map<string, number[]>;
  supplierLeadHistory: Map<string, SupplierLeadHistoryEntry[]>;
  supplierOutcomes: Map<string, OrderOutcome[]>;
}): void {
  const {
    dataset,
    now,
    categoryObservations,
    categoryRelativeErrors,
    supplierLeadHistory,
    supplierOutcomes,
  } = args;
  const result = recalibrate({
    estimatorHistories: SEED_CATALOG.map((item) => ({
      category: item.itemKey,
      observations: [...(categoryObservations.get(item.itemKey) ?? [])],
      relativeErrors: [...(categoryRelativeErrors.get(item.itemKey) ?? [])],
    })),
    matchOutcomes: [],
    leadTimeSuppliers: [...supplierLeadHistory.entries()].map(([supplierId, history]) => ({
      supplierId,
      history: [...history],
    })),
    supplierOutcomes: new Map([...supplierOutcomes.entries()].map(([k, v]) => [k, [...v]])),
    now: now.toISOString(),
  });

  const nSamples = result.estimators.reduce((s, e) => s + e.nSamples, 0);
  dataset.modelSnapshots.push(
    {
      id: randomUUID(),
      model: 'estimator',
      params: {
        byCategory: result.estimators.map((e) => ({
          category: e.category,
          regression: e.regression,
        })),
      },
      metrics: {
        byCategory: result.estimators.map((e) => ({
          category: e.category,
          marginPct: e.marginPct,
          mape: e.mape,
        })),
      },
      trainedAt: now,
      nSamples,
    },
    {
      id: randomUUID(),
      model: 'matcher',
      params: { weights: result.match.weights },
      metrics: { nSamples: result.match.nSamples },
      trainedAt: now,
      nSamples: result.match.nSamples,
    },
    {
      id: randomUUID(),
      model: 'leadtime',
      params: {
        bySupplier: result.leadTimes.map((l) => ({
          supplierId: l.supplierId,
          kShrunk: l.reliability.kShrunk,
        })),
      },
      metrics: {
        nSuppliersWithHistory: result.leadTimes.filter((l) => l.reliability.nSamples > 0).length,
      },
      trainedAt: now,
      nSamples: result.leadTimes.reduce((s, l) => s + l.reliability.nSamples, 0),
    },
  );
}

// ---------------------------------------------------------------------------
// Спецзаказ демо-сцены (agents.md §13): 6 позиций, 5 КП, 2 с пропусками, 1 с невыполнимым сроком
// ---------------------------------------------------------------------------

function buildQuotesReceivedDemoOrder(args: {
  dataset: SeedDataset;
  rng: () => number;
  referenceDate: Date;
  ctx: SharedCtx;
}): void {
  const { dataset, rng, referenceDate, ctx } = args;
  const {
    buyerCompanyId,
    buyerUserId,
    conciergeUserId,
    supplierCompanyIdBySeedKey,
    categoryAvgSupplierRate,
  } = ctx;

  const category: SeedCategory = 'merch';
  const catalog = catalogInCategory(category);
  const sixItems = [...catalog, ...catalog].slice(0, 6);
  const requestId = randomUUID();
  // Пять стадий идут по дню на каждую и обязаны закончиться СЕГОДНЯ: заказ
  // ждёт разбора КП прямо сейчас. При старте в -2 последние два события
  // оказывались в будущем, и таймлайн у покупателя показывал даты, которые
  // ещё не наступили.
  const createdAt = addDays(referenceDate, -4);
  // Дедлайн обязан быть шире самого длинного допустимого срока в КП (до 10 дней) плюс
  // буфер логистики, иначе combine() честно бракует ВСЕ предложения по сроку и
  // главный экран продукта показывает «ни один вариант не прошёл допустимость».
  // Ровно это и произошло: при +6 днях сид проходил только потому, что считал
  // себя по накопленной истории срока (kShrunk < 1), а живой экран сравнения
  // без снапшота leadtime берёт k'=1.0 и получает срок больше дедлайна.
  // Запас до 20 дней оставляет место и варианту «с запасом по сроку» (§13,
  // сцена 5), и отбраковке предложения на 45 дней (сцена 4).
  const deadlineDate = addDays(referenceDate, 20);

  const requestItems = sixItems.map((item) => ({
    id: randomUUID(),
    item,
    qty: randInt(rng, item.qtyMin, Math.min(item.qtyMax, item.qtyMin + 200)),
  }));

  dataset.requests.push({
    id: requestId,
    buyerCompanyId,
    createdBy: buyerUserId,
    title: DEMO_ORDER_REQUEST_TITLE,
    rawText: `Нужно к мероприятию: ${requestItems.map((ri) => `${ri.item.name} — ${ri.qty} ${ri.item.unit}`).join('; ')}. Дедлайн ${isoDateOnly(deadlineDate)}.`,
    deadlineDate: isoDateOnly(deadlineDate),
    budgetKzt: roundKzt(requestItems.reduce((s, ri) => s + ri.item.baseUnitPriceKzt * ri.qty, 0)),
    deliveryAddress: 'г. Алматы, офис заказчика',
    city: 'Алматы',
    status: 'estimated',
    extractionConfidence: 0.91,
    createdAt,
    updatedAt: createdAt,
  });

  for (const ri of requestItems) {
    dataset.requestItems.push({
      id: ri.id,
      requestId,
      name: ri.item.name,
      category: ri.item.category,
      qty: ri.qty,
      unit: ri.item.unit,
      specs: {},
      requiredCapabilities: [...ri.item.requiredCapabilities],
      needsClarification: false,
      clarificationReason: null,
    });
  }

  const estimateP50 = requestItems.reduce((s, ri) => s + ri.item.baseUnitPriceKzt * ri.qty, 0);
  dataset.estimates.push({
    id: randomUUID(),
    requestId,
    p50Kzt: roundKzt(estimateP50),
    p80Kzt: roundKzt(estimateP50 * 1.14),
    marginPct: 0.14,
    basis: {
      nSamples: 24,
      note: 'запас 14%, было 25% девять месяцев назад — демо-сценарий agents.md §13',
    },
    createdAt,
  });

  const placeholderPlanId = randomUUID();
  dataset.plans.push({
    id: placeholderPlanId,
    requestId,
    version: 1,
    kind: 'manual',
    totalSupplierKzt: 0,
    deliveryKzt: 0,
    commissionKzt: 0,
    commissionBase: 'supplier_ex_delivery',
    taxEffectKzt: 0,
    totalKzt: 0,
    etaDate: null,
    slackDays: null,
    supplierCount: 0,
    explanation: {
      decomposition: [],
      notes: ['КП получены — варианты ещё не собраны, это и есть демо-сцена agents.md §13.'],
      comparedOffersCount: 0,
      rejectedOffersCount: 0,
    } satisfies Explanation & { comparedOffersCount: number; rejectedOffersCount: number },
    status: 'draft',
    createdAt,
  });
  const orderId = randomUUID();
  dataset.orders.push({
    id: orderId,
    requestId,
    approvedPlanId: placeholderPlanId,
    state: 'quotes_received',
    conciergeUserId,
    acceptedAt: null,
    closedAt: null,
    finalCostKzt: null,
    settlement: null,
    settlementAmountKzt: null,
  });
  const stages: OrderState[] = ['draft', 'estimated', 'prepaid', 'rfq_sent', 'quotes_received'];
  let prevStage: OrderState | null = null;
  let stageAt = createdAt;
  for (const stage of stages) {
    dataset.orderStageEvents.push({
      id: randomUUID(),
      orderId,
      fromState: prevStage,
      toState: stage,
      actorUserId: conciergeUserId,
      at: stageAt,
    });
    if (prevStage !== null) {
      const timeStage = TIME_ENTRY_STAGE_BY_STATE[prevStage];
      dataset.timeEntries.push({
        orderId,
        userId: conciergeUserId,
        stage: timeStage,
        // Демо-заказ — «сегодняшний», то есть уже с накопленным опытом:
        // тот же множитель, что у последних закрытых заказов истории.
        seconds: Math.round(
          ACTIVE_MINUTES_BY_TIME_ENTRY_STAGE[timeStage] * 60 * (1 - ACTIVE_TIME_LEARNING_DROP),
        ),
        source: 'auto',
        createdAt: stageAt,
        updatedAt: stageAt,
      });
    }
    prevStage = stage;
    stageAt = addDays(stageAt, 1);
  }

  const fiveSuppliers = SEED_SUPPLIER_COMPANIES.filter((s) =>
    s.supplier.categories.includes(category),
  ).slice(0, 5);
  const rfqSentAt = addDays(createdAt, 1);

  for (const [supplierIdx, sc] of fiveSuppliers.entries()) {
    const rfqId = randomUUID();
    const supplierId = supplierCompanyIdBySeedKey.get(sc.seedKey) ?? '';
    dataset.rfqs.push({
      id: rfqId,
      requestId,
      supplierCompanyId: supplierId,
      token: randomUUID(),
      sentAt: rfqSentAt,
      respondBy: addDays(rfqSentAt, 3),
      status: 'quoted',
      assignedSupplierUserId: null,
      selectionReason: { reason: 'category_and_capability_match', category },
      isExploration: supplierIdx === fiveSuppliers.length - 1,
    });

    const submittedAt = addDays(rfqSentAt, randInt(rng, 1, 2));
    const quoteId = randomUUID();
    // КП №4 (индекс 3) — невыполнимый срок; КП №1 и №2 — по пропущенному полю (agents.md §13: "2 с пропущенными полями, 1 с невыполнимым сроком").
    const isImpossibleDeadline = supplierIdx === 3;
    const hasMissingFields = supplierIdx === 0 || supplierIdx === 1;

    dataset.quotes.push({
      id: quoteId,
      rfqId,
      submittedAt,
      validUntil: isoDateOnly(addDays(submittedAt, 14)),
      currency: 'KZT',
      notes: hasMissingFields ? 'Часть полей уточняется дополнительно.' : null,
      source: 'form',
      fileUrl: null,
    });

    const avgRate = categoryAvgSupplierRate.get(category) ?? sc.supplier.baseUnitPriceKzt;
    const priceFactor = (sc.supplier.baseUnitPriceKzt / avgRate) * (0.92 + rng() * 0.16);

    for (const ri of requestItems) {
      if (!ri.item.requiredCapabilities.every((c) => sc.supplier.capabilities.includes(c)))
        continue;
      const unitPriceKzt = roundKzt(
        ri.item.baseUnitPriceKzt * priceFactor * qtyDiscountFactor(ri.item, ri.qty),
      );
      const leadTimeDays = isImpossibleDeadline
        ? 45 // явно за пределами дедлайна — демонстрация отбраковки combine()
        : Math.max(1, Math.round(sc.supplier.leadTimeDaysDefault * (0.9 + rng() * 0.2)));
      dataset.quoteLines.push({
        id: randomUUID(),
        quoteId,
        requestItemId: ri.id,
        unitPriceKzt,
        minQty: null,
        setupFeeKzt: rng() < 0.5 ? randInt(rng, 0, 12_000) : 0,
        leadTimeDays,
        bundleRule:
          rng() < 0.3 ? { thresholdKzt: roundKzt(unitPriceKzt * 60), discountPct: 10 } : null,
        capabilityConfirmed: !hasMissingFields || rng() > 0.4,
        fieldFlags: hasMissingFields ? { missing: ['delivery_terms'] } : {},
      });
    }
  }
}
