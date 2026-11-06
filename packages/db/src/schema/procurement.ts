import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole, authUid, serviceRole } from 'drizzle-orm/supabase';
import { id, timestamps } from './_columns.js';
import {
  documentTypeEnum,
  orderStateEnum,
  planKindEnum,
  planStatusEnum,
  prepaymentStatusEnum,
  quoteSourceEnum,
  requestStatusEnum,
  rfqStatusEnum,
  settlementEnum,
} from './enums.js';
import {
  companies,
  currentCompanyIdSubquery,
  currentRoleSubquery,
  rfqRequestIdsForCurrentSupplierSubquery,
  users,
} from './identity.js';

/**
 * Закупочный цикл — agents.md §5. Изоляция поставщиков (§3.4, тест §15):
 * `rfqs`/`quotes`/`quote_lines` фильтруются по `supplier_company_id` —
 * поставщик A физически не получает строки поставщика B по тому же RFQ,
 * потому что policy сравнивает с ЕГО company_id, а не с company_id заказа.
 */

const staffOnly = sql`${currentRoleSubquery} in ('concierge', 'admin')`;

/**
 * Видимость строки, привязанной к requests через request_id — покупателю
 * своей заявки и staff. НЕ через "id in (select id from requests)": до
 * requests_select_supplier_via_rfq так делали почти все select_via_request
 * policy ниже, и это молча предполагало, что requests видна ТОЛЬКО
 * покупателю — как только requests стала видна ещё и поставщику (по его
 * RFQ), это давало утечку: поставщик получал доступ к estimates/prepayments/
 * plans/plan_rejections чужой заявки только потому, что мог прочитать саму
 * requests. Явная проверка buyer_company_id/staff не зависит от того, кому
 * ещё видна requests.
 */
// biome-ignore lint/suspicious/noExplicitAny: accepts any pgTable's requestId column for the sql`` template below
function visibleToBuyerOrStaff(requestIdColumn: any) {
  return sql`${requestIdColumn} in (
    select id from ${requests} where buyer_company_id = ${currentCompanyIdSubquery}
  ) or ${staffOnly}`;
}

export const requests = pgTable(
  'requests',
  {
    id: id(),
    buyerCompanyId: uuid('buyer_company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    rawText: text('raw_text').notNull(),
    deadlineDate: date('deadline_date'),
    budgetKzt: bigint('budget_kzt', { mode: 'number' }),
    deliveryAddress: text('delivery_address'),
    city: text('city'),
    status: requestStatusEnum('status').notNull().default('draft'),
    extractionConfidence: real('extraction_confidence'),
    /** Ключ идемпотентности отправки формы: повторная отправка возвращает уже созданную заявку. */
    submissionKey: uuid('submission_key'),
    ...timestamps,
  },
  (t) => [
    check('requests_budget_nonnegative', sql`${t.budgetKzt} is null or ${t.budgetKzt} >= 0`),
    index('requests_buyer_company_id_idx').on(t.buyerCompanyId),
    index('requests_created_by_idx').on(t.createdBy),
    uniqueIndex('requests_created_by_submission_key_unique')
      .on(t.createdBy, t.submissionKey)
      .where(sql`${t.submissionKey} is not null`),
    pgPolicy('requests_select_own_company', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.buyerCompanyId} = ${currentCompanyIdSubquery}`,
    }),
    pgPolicy('requests_select_staff', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: staffOnly,
    }),
    pgPolicy('requests_insert_own_company', {
      as: 'permissive',
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${t.buyerCompanyId} = ${currentCompanyIdSubquery}`,
    }),
    pgPolicy('requests_update_staff', {
      as: 'permissive',
      for: 'update',
      to: authenticatedRole,
      using: staffOnly,
      withCheck: staffOnly,
    }),
    // Поставщик видит заявку, только если ему по ней отправили RFQ — не
    // раньше. Через SECURITY DEFINER-функцию (identity.ts,
    // rfqRequestIdsForCurrentSupplierSubquery), а не прямой подзапрос в
    // "rfqs": rfqs_select_buyer_of_request (миграция 0000) сама подзапрашивает
    // requests, и прямой подзапрос здесь замкнул бы requests↔rfqs в
    // ERROR 42P17 (см. identity.ts у объявления константы).
    pgPolicy('requests_select_supplier_via_rfq', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.id} in (select ${rfqRequestIdsForCurrentSupplierSubquery})`,
    }),
    pgPolicy('requests_service_all', {
      as: 'permissive',
      for: 'all',
      to: serviceRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();

export const requestItems = pgTable(
  'request_items',
  {
    id: id(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    category: text('category').notNull(),
    qty: integer('qty').notNull(),
    unit: text('unit').notNull(),
    specs: jsonb('specs').notNull().default({}),
    requiredCapabilities: text('required_capabilities')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    needsClarification: boolean('needs_clarification').notNull().default(false),
    clarificationReason: text('clarification_reason'),
    ...timestamps,
  },
  (t) => [
    check('request_items_qty_positive', sql`${t.qty} > 0`),
    index('request_items_request_id_idx').on(t.requestId),
    // Позиции нужны и поставщику с RFQ по этой заявке (без них нечего
    // оценивать в форме ответа) — единственная из этой группы policy, где
    // видимость сознательно шире buyer+staff.
    pgPolicy('request_items_select_via_request', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${visibleToBuyerOrStaff(t.requestId)} or ${t.requestId} in (select ${rfqRequestIdsForCurrentSupplierSubquery})`,
    }),
    // Мастер заявки (agents.md §10 «Покупатель») пишет позиции сам, от
    // своей же компании — единственная точка входа для request_items,
    // orders для этой заявки появится позже, отдельным действием консьержа.
    pgPolicy('request_items_insert_buyer_own', {
      as: 'permissive',
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${t.requestId} in (
        select id from ${requests} where buyer_company_id = ${currentCompanyIdSubquery}
      )`,
    }),
    // Правка категории/названия консьержем (agents.md §8A: исправление —
    // источник обучающего сигнала для Classification Engine) и split/merge
    // позиций (Dependency Engine) — обе идут через staff-сессию, не
    // service_role. «Допустимо ли на этой стадии заказа» — в приложении
    // (ITEMS_EDITABLE_STATES), не в policy, тем же приёмом, что уже
    // используется у plans/orders.
    pgPolicy('request_items_update_staff', {
      as: 'permissive',
      for: 'update',
      to: authenticatedRole,
      using: staffOnly,
      withCheck: staffOnly,
    }),
    // Dependency Engine (agents.md §8A, волна 1 шаг 6): split/merge позиции
    // консьержем — рукописные SQL-функции split_request_item/
    // merge_request_items (миграция 0011) сами insert новые строки и delete
    // исходные одной транзакцией, SECURITY INVOKER — выполняются от имени
    // вызывающего, эти две policy и есть реальная граница доступа.
    pgPolicy('request_items_insert_staff', {
      as: 'permissive',
      for: 'insert',
      to: authenticatedRole,
      withCheck: staffOnly,
    }),
    // Первая DELETE-политика на этой таблице — раньше строки request_items
    // не удалялись никогда (только insert/update), split/merge впервые
    // вводит такую операцию.
    pgPolicy('request_items_delete_staff', {
      as: 'permissive',
      for: 'delete',
      to: authenticatedRole,
      using: staffOnly,
    }),
    pgPolicy('request_items_service_all', {
      as: 'permissive',
      for: 'all',
      to: serviceRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();

/** Калькулятор предоплаты — agents.md §8B. */
export const estimates = pgTable(
  'estimates',
  {
    id: id(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    p50Kzt: bigint('p50_kzt', { mode: 'number' }).notNull(),
    p80Kzt: bigint('p80_kzt', { mode: 'number' }).notNull(),
    marginPct: real('margin_pct').notNull(),
    basis: jsonb('basis').notNull(),
    ...timestamps,
  },
  (t) => [
    check('estimates_amounts_nonnegative', sql`${t.p50Kzt} >= 0 and ${t.p80Kzt} >= 0`),
    uniqueIndex('estimates_request_id_idx').on(t.requestId),
    pgPolicy('estimates_select_via_request', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: visibleToBuyerOrStaff(t.requestId),
    }),
    pgPolicy('estimates_insert_staff', {
      as: 'permissive',
      for: 'insert',
      to: authenticatedRole,
      withCheck: staffOnly,
    }),
    pgPolicy('estimates_service_all', {
      as: 'permissive',
      for: 'all',
      to: serviceRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();

export const prepayments = pgTable(
  'prepayments',
  {
    id: id(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    amountKzt: bigint('amount_kzt', { mode: 'number' }).notNull(),
    invoiceNo: text('invoice_no'),
    status: prepaymentStatusEnum('status').notNull().default('issued'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    proofUrl: text('proof_url'),
    ...timestamps,
  },
  (t) => [
    check('prepayments_amount_nonnegative', sql`${t.amountKzt} >= 0`),
    uniqueIndex('prepayments_request_id_idx').on(t.requestId),
    pgPolicy('prepayments_select_via_request', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: visibleToBuyerOrStaff(t.requestId),
    }),
    pgPolicy('prepayments_insert_staff', {
      as: 'permissive',
      for: 'insert',
      to: authenticatedRole,
      withCheck: staffOnly,
    }),
    // Без UPDATE-политики staff не мог ни выставить счёт повторно (upsert падал на
    // ON CONFLICT DO UPDATE), ни подтвердить предоплату: confirm_prepayment берёт
    // строку через SELECT ... FOR UPDATE, а под RLS блокировка строки невозможна
    // без права UPDATE — строка «не находилась». Статус paid по-прежнему требует
    // банковского факта (триггер prepayments_paid_guard).
    pgPolicy('prepayments_update_staff', {
      as: 'permissive',
      for: 'update',
      to: authenticatedRole,
      using: staffOnly,
      withCheck: staffOnly,
    }),
    pgPolicy('prepayments_service_all', {
      as: 'permissive',
      for: 'all',
      to: serviceRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();

export const rfqs = pgTable(
  'rfqs',
  {
    id: id(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    supplierCompanyId: uuid('supplier_company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    token: text('token').notNull().unique(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    respondBy: timestamp('respond_by', { withTimezone: true }),
    status: rfqStatusEnum('status').notNull().default('sent'),
    assignedSupplierUserId: uuid('assigned_supplier_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    selectionReason: jsonb('selection_reason').notNull().default({}),
    isExploration: boolean('is_exploration').notNull().default(false),
    /** Staff can ask the supplier to correct a submitted quote without deleting history. */
    revisionRequested: boolean('revision_requested').notNull().default(false),
    revisionNote: text('revision_note'),
    ...timestamps,
  },
  (t) => [
    index('rfqs_request_id_idx').on(t.requestId),
    index('rfqs_supplier_company_id_idx').on(t.supplierCompanyId),
    index('rfqs_assigned_supplier_user_id_idx').on(t.assignedSupplierUserId),
    // Изоляция поставщиков — agents.md §3.4, обязательный тест §15.
    // Поставщик видит ТОЛЬКО RFQ, отправленные ЕГО компании.
    pgPolicy('rfqs_select_own_supplier', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.supplierCompanyId} = ${currentCompanyIdSubquery} and public.supplier_can_access_rfq(${t.id})`,
    }),
    // Внимание: раньше здесь было "request_id in (select id from requests)",
    // положившееся на то, что видимость requests сама всё отфильтрует. Это
    // держалось, пока requests был виден ТОЛЬКО покупателю. Как только
    // requests_select_supplier_via_rfq сделал заявку видимой ещё и
    // поставщику (у которого есть RFQ по ней), это давало утечку между
    // поставщиками: поставщик A видел ВСЕ rfqs той же заявки, включая
    // строку поставщика B — нарушение agents.md §3.4 (обязательный тест
    // изоляции). Явная проверка buyer_company_id возвращает policy к её
    // исходному смыслу — «покупатель видит RFQ своей заявки» — не завися
    // от того, кому ещё видна сама requests.
    pgPolicy('rfqs_select_staff', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: staffOnly,
    }),
    pgPolicy('rfqs_insert_staff', {
      as: 'permissive',
      for: 'insert',
      to: authenticatedRole,
      withCheck: staffOnly,
    }),
    pgPolicy('rfqs_service_all', {
      as: 'permissive',
      for: 'all',
      to: serviceRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();

export const quotes = pgTable(
  'quotes',
  {
    id: id(),
    rfqId: uuid('rfq_id')
      .notNull()
      .references(() => rfqs.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
    supersedesQuoteId: uuid('supersedes_quote_id'),
    submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    validUntil: date('valid_until'),
    currency: text('currency').notNull().default('KZT'),
    notes: text('notes'),
    revisionReason: text('revision_reason'),
    source: quoteSourceEnum('source').notNull().default('form'),
    fileUrl: text('file_url'),
    ...timestamps,
  },
  (t) => [
    index('quotes_rfq_id_idx').on(t.rfqId),
    uniqueIndex('quotes_rfq_version_unique').on(t.rfqId, t.version),
    // Через rfq_id таблица уже наследует изоляцию поставщиков rfqs —
    // «свой RFQ» здесь означает и «своё quote».
    pgPolicy('quotes_select_own_supplier', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.rfqId} in (select id from ${rfqs} where supplier_company_id = ${currentCompanyIdSubquery} and public.supplier_can_access_rfq(id))`,
    }),
    // Раньше здесь была quotes_select_buyer_of_request (тот же риск, что у
    // rfqs_select_buyer_of_request — см. комментарий там). Убрана целиком
    // (не сужена) при аудите agents.md §10: quotes.notes/file_url —
    // свободный текст и файл от ИМЕНИ поставщика (не структурные price/
    // lead_time), способные раскрыть личность исполнителя напрямую
    // (подпись, контакты, брендированный PDF) — то, что покупателю
    // недоступно по замыслу. RLS не различает колонки внутри строки, а
    // ни один buyer-маршрут в apps/web не читает quotes вообще (только
    // agregированный combine()-результат через comparison.ts — экран
    // сравнения консьержа, не buyer) — политика была чистой дырой без
    // единого легитимного применения. Понадобится покупателю view на
    // quotes — заводить её явно суженной (без notes/file_url), не
    // возвращать это разрешение.
    pgPolicy('quotes_select_staff', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: staffOnly,
    }),
    pgPolicy('quotes_service_all', {
      as: 'permissive',
      for: 'all',
      to: serviceRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();

export const quoteLines = pgTable(
  'quote_lines',
  {
    id: id(),
    quoteId: uuid('quote_id')
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade' }),
    requestItemId: uuid('request_item_id')
      .notNull()
      .references(() => requestItems.id, { onDelete: 'restrict' }),
    unitPriceKzt: bigint('unit_price_kzt', { mode: 'number' }).notNull(),
    minQty: integer('min_qty'),
    setupFeeKzt: bigint('setup_fee_kzt', { mode: 'number' }).notNull().default(0),
    leadTimeDays: integer('lead_time_days').notNull(),
    bundleRule: jsonb('bundle_rule'),
    capabilityConfirmed: boolean('capability_confirmed').notNull().default(false),
    fieldFlags: jsonb('field_flags').notNull().default({}),
    ...timestamps,
  },
  (t) => [
    index('quote_lines_quote_id_idx').on(t.quoteId),
    index('quote_lines_request_item_id_idx').on(t.requestItemId),
    pgPolicy('quote_lines_select_own_supplier', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.quoteId} in (
        select id from ${quotes} where rfq_id in (
          select id from ${rfqs} where supplier_company_id = ${currentCompanyIdSubquery} and public.supplier_can_access_rfq(id)
        )
      )`,
    }),
    pgPolicy('quote_lines_select_staff', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: staffOnly,
    }),
    pgPolicy('quote_lines_service_all', {
      as: 'permissive',
      for: 'all',
      to: serviceRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();

/** Варианты плана — agents.md §8D, сердце продукта. */
export const plans = pgTable(
  'plans',
  {
    id: id(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
    kind: planKindEnum('kind').notNull(),
    totalSupplierKzt: bigint('total_supplier_kzt', { mode: 'number' }).notNull(),
    deliveryKzt: bigint('delivery_kzt', { mode: 'number' }).notNull(),
    commissionKzt: bigint('commission_kzt', { mode: 'number' }).notNull(),
    commissionBase: text('commission_base').notNull(),
    taxEffectKzt: bigint('tax_effect_kzt', { mode: 'number' }).notNull().default(0),
    /** Дополнительное вознаграждение от поставщика, раскрываемое покупателю отдельно. */
    supplierRebateKzt: bigint('supplier_rebate_kzt', { mode: 'number' }).notNull().default(0),
    totalKzt: bigint('total_kzt', { mode: 'number' }).notNull(),
    etaDate: date('eta_date'),
    slackDays: integer('slack_days'),
    supplierCount: integer('supplier_count').notNull(),
    explanation: jsonb('explanation').notNull(),
    status: planStatusEnum('status').notNull().default('draft'),
    ...timestamps,
  },
  (t) => [
    check(
      'plans_amounts_nonnegative',
      sql`${t.totalSupplierKzt} >= 0 and ${t.deliveryKzt} >= 0 and ${t.commissionKzt} >= 0 and ${t.taxEffectKzt} >= 0 and ${t.supplierRebateKzt} >= 0 and ${t.totalKzt} >= 0`,
    ),
    index('plans_request_id_idx').on(t.requestId),
    // Buyer price/date reads use get_buyer_plans; raw financial components and
    // explanation JSON are staff-only (product specification section 7).
    pgPolicy('plans_select_via_request', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: staffOnly,
    }),
    // Пишет только движок сравнения через packages/engine order/transition() —
    // agents.md §6: единственная функция переходов, прямых update из UI нет.
    // Здесь — кто физически может дёрнуть запись: staff предлагает план
    // (proposePlan), покупатель утверждает свой (approvePlan) — граница
    // «допустимый ли это переход» проверяется в приложении, а не в policy.
    pgPolicy('plans_insert_staff', {
      as: 'permissive',
      for: 'insert',
      to: authenticatedRole,
      withCheck: staffOnly,
    }),
    pgPolicy('plans_update_staff', {
      as: 'permissive',
      for: 'update',
      to: authenticatedRole,
      using: staffOnly,
      withCheck: staffOnly,
    }),
    // Было plans_update_buyer_own — UPDATE без ограничения по колонкам,
    // хотя approvePlan() в приложении трогает только status. RLS не умеет
    // колоночно: прямой PostgREST-запрос от покупателя мог бы переписать
    // commission_kzt/total_kzt/total_supplier_kzt в СВОЁМ же плане (подмена
    // цены). Заменено на SECURITY DEFINER RPC
    // approve_plan(p_order_id, p_expected_plan_id, p_expected_plan_version) —
    // тот же приём, что split_request_item/merge_request_items (волна 1,
    // шаг 6): функция сама проверяет владение заказом и меняет только
    // status, буквальный UPDATE-доступ покупателю на эту таблицу больше не
    // выдаётся вообще.
    pgPolicy('plans_service_all', {
      as: 'permissive',
      for: 'all',
      to: serviceRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();

export const planLines = pgTable(
  'plan_lines',
  {
    id: id(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    requestItemId: uuid('request_item_id')
      .notNull()
      .references(() => requestItems.id, { onDelete: 'restrict' }),
    supplierCompanyId: uuid('supplier_company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    quoteLineId: uuid('quote_line_id')
      .notNull()
      .references(() => quoteLines.id, { onDelete: 'restrict' }),
    qty: integer('qty').notNull(),
    lineTotalKzt: bigint('line_total_kzt', { mode: 'number' }).notNull(),
    /** Комиссия по этой конкретной позиции — по умолчанию плоский процент
     *  из settings (proposePlan), консьерж может задать другой в диапазоне
     *  21-24% (packages/engine/src/commission). Снимок на момент правки —
     *  agents.md §7 правило 8: задним числом не меняется, только вперёд. */
    commissionPct: real('commission_pct').notNull().default(23),
    commissionKzt: bigint('commission_kzt', { mode: 'number' }).notNull().default(0),
    ...timestamps,
  },
  (t) => [
    check('plan_lines_qty_positive', sql`${t.qty} > 0`),
    index('plan_lines_plan_id_idx').on(t.planId),
    index('plan_lines_request_item_id_idx').on(t.requestItemId),
    index('plan_lines_supplier_company_id_idx').on(t.supplierCompanyId),
    index('plan_lines_quote_line_id_idx').on(t.quoteLineId),
    // Имя не переименовано в *_select_staff (drizzle-kit иначе спрашивает
    // интерактивно rename-or-new, недоступно в этой среде — тот же приём,
    // что уже применялся в этой сессии для extraction_aliases_select_staff)
    // — было `planId in (select id from plans)`, тот же анти-паттерн, что
    // уже пофикшен для requests/rfqs (см. комментарий у visibleToBuyerOrStaff
    // выше): раз plans видна и покупателю, то и ЛЮБАЯ plan_lines была видна
    // ему целиком через прямой PostgREST — включая supplier_company_id,
    // прямое нарушение ADR-0009 (личность поставщика не раскрывается
    // покупателю). Ни один buyer-маршрут сегодня напрямую .from('plan_lines')
    // не читает (только order-actions.ts/comparison.ts на стороне
    // консьержа) — сузить до staff можно без потери функциональности.
    pgPolicy('plan_lines_select_via_plan', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: staffOnly,
    }),
    // Поставщик видит только собственные строки утверждённых планов. Это
    // нужно не для раскрытия чужих КП, а чтобы RLS мог показать поставщику
    // сам заказ и его статус через orders_select_supplier_in_plan.
    pgPolicy('plan_lines_select_own_supplier', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.supplierCompanyId} = ${currentCompanyIdSubquery}
        and ${currentRoleSubquery} in ('owner', 'manager')
        and public.supplier_can_access_plan_line(${t.planId}, ${t.supplierCompanyId})`,
    }),
    pgPolicy('plan_lines_insert_staff', {
      as: 'permissive',
      for: 'insert',
      to: authenticatedRole,
      withCheck: staffOnly,
    }),
    // Первая UPDATE-политика на этой таблице — нужна для правки
    // commission_pct/commission_kzt консьержем (updatePlanLineCommission).
    pgPolicy('plan_lines_update_staff', {
      as: 'permissive',
      for: 'update',
      to: authenticatedRole,
      using: staffOnly,
      withCheck: staffOnly,
    }),
    pgPolicy('plan_lines_service_all', {
      as: 'permissive',
      for: 'all',
      to: serviceRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();

/** Журнал отбраковки — agents.md §8D, продуктовая функция, видна покупателю. */
export const planRejections = pgTable(
  'plan_rejections',
  {
    id: id(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    planContext: text('plan_context').notNull(),
    quoteLineId: uuid('quote_line_id').references(() => quoteLines.id, { onDelete: 'set null' }),
    reasonCode: text('reason_code').notNull(),
    reasonHuman: text('reason_human').notNull(),
    ...timestamps,
  },
  (t) => [
    index('plan_rejections_request_id_idx').on(t.requestId),
    index('plan_rejections_quote_line_id_idx').on(t.quoteLineId),
    pgPolicy('plan_rejections_select_via_request', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: visibleToBuyerOrStaff(t.requestId),
    }),
    pgPolicy('plan_rejections_insert_staff', {
      as: 'permissive',
      for: 'insert',
      to: authenticatedRole,
      withCheck: staffOnly,
    }),
    pgPolicy('plan_rejections_service_all', {
      as: 'permissive',
      for: 'all',
      to: serviceRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();

export const orders = pgTable(
  'orders',
  {
    id: id(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'restrict' })
      .unique(),
    approvedPlanId: uuid('approved_plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    state: orderStateEnum('state').notNull().default('draft'),
    conciergeUserId: uuid('concierge_user_id').references(() => users.id, { onDelete: 'set null' }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    finalCostKzt: bigint('final_cost_kzt', { mode: 'number' }),
    settlement: settlementEnum('settlement'),
    settlementAmountKzt: bigint('settlement_amount_kzt', { mode: 'number' }),
    ...timestamps,
  },
  (t) => [
    index('orders_approved_plan_id_idx').on(t.approvedPlanId),
    index('orders_concierge_user_id_idx').on(t.conciergeUserId),
    pgPolicy('orders_select_via_request', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: visibleToBuyerOrStaff(t.requestId),
    }),
    // Заказ виден и поставщикам, чьи строки вошли в утверждённый план.
    pgPolicy('orders_select_supplier_in_plan', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`public.supplier_can_access_order(${t.id})`,
    }),
    // Допустимость самого перехода (from → to по актёру) проверяет
    // packages/engine order/transition() в server action ДО этого UPDATE;
    // здесь — только «кто в принципе имеет право трогать эту строку».
    // Триггер enforce_order_transition (см. миграцию) — второй, независимый
    // барьер на уровне БД: запрещает переход, которого нет в графе, даже
    // если бы кто-то обошёл приложение и написал UPDATE напрямую.
    // Заказ физически появляется, когда консьерж берёт заявку в работу
    // (intakeRequest — плейсхолдер-план + orders на state='draft') — до
    // этого момента заявка существует сама по себе, без orders-строки.
    pgPolicy('orders_insert_staff', {
      as: 'permissive',
      for: 'insert',
      to: authenticatedRole,
      withCheck: staffOnly,
    }),
    pgPolicy('orders_update_staff', {
      as: 'permissive',
      for: 'update',
      to: authenticatedRole,
      using: staffOnly,
      withCheck: staffOnly,
    }),
    pgPolicy('orders_update_buyer_own', {
      as: 'permissive',
      for: 'update',
      to: authenticatedRole,
      using: sql`${t.requestId} in (
        select id from ${requests} where buyer_company_id = ${currentCompanyIdSubquery}
      )`,
      withCheck: sql`${t.requestId} in (
        select id from ${requests} where buyer_company_id = ${currentCompanyIdSubquery}
      )`,
    }),
    pgPolicy('orders_update_supplier_delivery', {
      as: 'permissive',
      for: 'update',
      to: authenticatedRole,
      using: sql`${t.state} = 'shipped' and public.supplier_can_access_order(${t.id}) and exists (
        select 1 from ${planLines} pl
        where pl.plan_id = ${t.approvedPlanId}
          and pl.supplier_company_id = ${currentCompanyIdSubquery}
      )`,
      withCheck: sql`${t.state} in ('shipped', 'delivered') and public.supplier_can_access_order(${t.id}) and exists (
        select 1 from ${planLines} pl
        where pl.plan_id = ${t.approvedPlanId}
          and pl.supplier_company_id = ${currentCompanyIdSubquery}
      )`,
    }),
    pgPolicy('orders_service_all', {
      as: 'permissive',
      for: 'all',
      to: serviceRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();

/** Подтверждения доставки по каждому поставщику — agents.md §6. */
export const orderSupplierDeliveries = pgTable(
  'order_supplier_deliveries',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    supplierCompanyId: uuid('supplier_company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    confirmedBy: uuid('confirmed_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('order_supplier_deliveries_order_supplier_idx').on(t.orderId, t.supplierCompanyId),
    index('order_supplier_deliveries_order_id_idx').on(t.orderId),
    index('order_supplier_deliveries_supplier_company_id_idx').on(t.supplierCompanyId),
    pgPolicy('order_supplier_deliveries_select_own_supplier', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.supplierCompanyId} = ${currentCompanyIdSubquery} and public.supplier_can_access_order(${t.orderId})`,
    }),
    pgPolicy('order_supplier_deliveries_select_staff', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: staffOnly,
    }),
    pgPolicy('order_supplier_deliveries_insert_own_supplier', {
      as: 'permissive',
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${t.supplierCompanyId} = ${currentCompanyIdSubquery}
        and ${t.confirmedBy} = ${authUid}
        and ${currentRoleSubquery} in ('owner', 'manager')
        and exists (
          select 1 from ${companies} c where c.id = ${t.supplierCompanyId} and c.type = 'supplier'
        )
        and exists (
          select 1 from ${orders} o
          join ${planLines} pl on pl.plan_id = o.approved_plan_id
          where o.id = ${t.orderId}
            and o.state = 'shipped'
            and pl.supplier_company_id = ${t.supplierCompanyId}
            and public.supplier_can_access_order(${t.orderId})
        )`,
    }),
    pgPolicy('order_supplier_deliveries_service_all', {
      as: 'permissive',
      for: 'all',
      to: serviceRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();

/** Audit log перехода состояний — agents.md §6: «каждый переход пишет событие с автором». */
export const orderStageEvents = pgTable(
  'order_stage_events',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    fromState: orderStateEnum('from_state'),
    toState: orderStateEnum('to_state').notNull(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    note: text('note'),
  },
  (t) => [
    index('order_stage_events_order_id_idx').on(t.orderId),
    index('order_stage_events_actor_user_id_idx').on(t.actorUserId),
    pgPolicy('order_stage_events_select_via_order', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.orderId} in (select id from ${orders})`,
    }),
    // Audit log только на чтение для authenticated: запись делает
    // SECURITY DEFINER-триггер на orders в миграции 0022, поэтому состояние
    // и его событие не могут разойтись, а клиент не может подделать историю.
    pgPolicy('order_stage_events_service_insert', {
      as: 'permissive',
      for: 'insert',
      to: serviceRole,
      withCheck: sql`true`,
    }),
    pgPolicy('order_stage_events_service_select', {
      as: 'permissive',
      for: 'select',
      to: serviceRole,
      using: sql`true`,
    }),
  ],
).enableRLS();

export const supplierPayouts = pgTable(
  'supplier_payouts',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    supplierCompanyId: uuid('supplier_company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    amountKzt: bigint('amount_kzt', { mode: 'number' }).notNull(),
    status: text('status').notNull().default('pending'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    docUrl: text('doc_url'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('supplier_payouts_order_supplier_idx').on(t.orderId, t.supplierCompanyId),
    check('supplier_payouts_amount_nonnegative', sql`${t.amountKzt} >= 0`),
    index('supplier_payouts_order_id_idx').on(t.orderId),
    index('supplier_payouts_supplier_company_id_idx').on(t.supplierCompanyId),
    pgPolicy('supplier_payouts_select_own_supplier', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.supplierCompanyId} = ${currentCompanyIdSubquery} and public.supplier_can_access_order(${t.orderId})`,
    }),
    pgPolicy('supplier_payouts_select_staff', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: staffOnly,
    }),
    pgPolicy('supplier_payouts_insert_staff', {
      as: 'permissive',
      for: 'insert',
      to: authenticatedRole,
      withCheck: staffOnly,
    }),
    pgPolicy('supplier_payouts_service_all', {
      as: 'permissive',
      for: 'all',
      to: serviceRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();

/**
 * Аудируемые банковские факты — входящие переводы покупателя, возвраты и
 * выплаты поставщикам. Статус заказа не является доказательством денег:
 * переходы используют только подтверждённые строки этой таблицы.
 */
export const paymentFacts = pgTable(
  'payment_facts',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    supplierCompanyId: uuid('supplier_company_id').references(() => companies.id, {
      onDelete: 'restrict',
    }),
    direction: text('direction').notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('pending'),
    amountKzt: bigint('amount_kzt', { mode: 'number' }).notNull(),
    reference: text('reference'),
    proofUrl: text('proof_url'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    confirmedBy: uuid('confirmed_by').references(() => users.id, { onDelete: 'set null' }),
    idempotencyKey: text('idempotency_key').notNull(),
    ...timestamps,
  },
  (t) => [
    check('payment_facts_amount_nonnegative', sql`${t.amountKzt} >= 0`),
    check(
      'payment_facts_reference_valid',
      sql`${t.status} = 'void' or length(trim(coalesce(${t.reference}, ''))) between 1 and 200`,
    ),
    check('payment_facts_direction_valid', sql`${t.direction} in ('inbound', 'outbound')`),
    check(
      'payment_facts_kind_valid',
      sql`${t.kind} in ('prepayment', 'surcharge', 'refund', 'supplier_payout')`,
    ),
    check('payment_facts_status_valid', sql`${t.status} in ('pending', 'confirmed', 'void')`),
    check(
      'payment_facts_kind_direction_valid',
      sql`(${t.direction} = 'inbound' and ${t.kind} in ('prepayment', 'surcharge')) or (${t.direction} = 'outbound' and ${t.kind} in ('refund', 'supplier_payout'))`,
    ),
    uniqueIndex('payment_facts_idempotency_key_idx').on(t.idempotencyKey),
    index('payment_facts_order_id_idx').on(t.orderId),
    index('payment_facts_status_idx').on(t.status),
    pgPolicy('payment_facts_select_staff', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: staffOnly,
    }),
    pgPolicy('payment_facts_select_buyer_own', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      // Покупатель видит свои входящие платежи и возврат ему же. Выплаты поставщикам
      // скрыты (ADR-0009). Без возврата закрытие со сверкой невозможно: приложение считает
      // сверку по видимым покупателю платежам и не находит возвращённое.
      using: sql`(${t.direction} = 'inbound' or (${t.direction} = 'outbound' and ${t.kind} = 'refund')) and ${t.orderId} in (select o.id from ${orders} o join ${requests} r on r.id = o.request_id where r.buyer_company_id = ${currentCompanyIdSubquery})`,
    }),
    pgPolicy('payment_facts_select_supplier_own', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.direction} = 'outbound' and ${t.supplierCompanyId} = ${currentCompanyIdSubquery} and public.supplier_can_access_order(${t.orderId})`,
    }),
    pgPolicy('payment_facts_insert_staff', {
      as: 'permissive',
      for: 'insert',
      to: authenticatedRole,
      withCheck: staffOnly,
    }),
    pgPolicy('payment_facts_update_staff', {
      as: 'permissive',
      for: 'update',
      to: authenticatedRole,
      using: staffOnly,
      withCheck: staffOnly,
    }),
    pgPolicy('payment_facts_service_all', {
      as: 'permissive',
      for: 'all',
      to: serviceRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();

export const documents = pgTable(
  'documents',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    stage: text('stage').notNull(),
    type: documentTypeEnum('type').notNull(),
    url: text('url').notNull(),
    meta: jsonb('meta').notNull().default({}),
    ...timestamps,
  },
  (t) => [
    index('documents_order_id_idx').on(t.orderId),
    // Buyer documents do not inherit supplier order visibility. supplier_invoice
    // remains staff-only: no supplier recipient is recorded on this table.
    // Explicit buyer types fail closed for future internal document types.
    // Company activity is checked separately from active-profile RLS helpers.
    pgPolicy('documents_select_via_order', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${staffOnly} or (
        ${currentRoleSubquery} in ('owner', 'manager')
        and ${t.type} in ('prepay_invoice', 'act', 'final_invoice', 'refund_confirmation', 'spec')
        and ${t.orderId} in (
          select o.id from ${orders} o
          join ${requests} r on r.id = o.request_id
          join ${companies} c on c.id = r.buyer_company_id
          where r.buyer_company_id = ${currentCompanyIdSubquery}
            and c.type = 'buyer' and c.is_active
        )
      )`,
    }),
    // Document Engine (agents.md §14 шаг 11) — счёт/акт пишет order-actions.ts
    // в момент перехода стадии заказа (prepaid → prepay_invoice, closed →
    // act), той же RLS-сессией текущего актёра, что и остальные записи
    // жизненного цикла (agents.md §6, без service_role). Актёр перехода
    // closed — покупатель ИЛИ staff (packages/engine/order/transition.ts),
    // поэтому withCheck пускает оба случая; audit event заказа при этом
    // создаётся отдельным PostgreSQL-триггером.
    pgPolicy('documents_insert_via_order', {
      as: 'permissive',
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${t.orderId} in (
        select o.id from ${orders} o
        join ${requests} r on r.id = o.request_id
        where ${staffOnly} or r.buyer_company_id = ${currentCompanyIdSubquery}
      )`,
    }),
    pgPolicy('documents_service_all', {
      as: 'permissive',
      for: 'all',
      to: serviceRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();
