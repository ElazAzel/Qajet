import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole, serviceRole } from 'drizzle-orm/supabase';
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
import { companies, currentCompanyIdSubquery, currentRoleSubquery, users } from './identity.js';

/**
 * Закупочный цикл — agents.md §5. Изоляция поставщиков (§3.4, тест §15):
 * `rfqs`/`quotes`/`quote_lines` фильтруются по `supplier_company_id` —
 * поставщик A физически не получает строки поставщика B по тому же RFQ,
 * потому что policy сравнивает с ЕГО company_id, а не с company_id заказа.
 */

const staffOnly = sql`${currentRoleSubquery} in ('concierge', 'admin')`;

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
    ...timestamps,
  },
  (t) => [
    index('requests_buyer_company_id_idx').on(t.buyerCompanyId),
    index('requests_created_by_idx').on(t.createdBy),
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
    index('request_items_request_id_idx').on(t.requestId),
    pgPolicy('request_items_select_via_request', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.requestId} in (select id from ${requests})`,
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
    index('estimates_request_id_idx').on(t.requestId),
    pgPolicy('estimates_select_via_request', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.requestId} in (select id from ${requests})`,
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
    index('prepayments_request_id_idx').on(t.requestId),
    pgPolicy('prepayments_select_via_request', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.requestId} in (select id from ${requests})`,
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
      using: sql`${t.supplierCompanyId} = ${currentCompanyIdSubquery}`,
    }),
    pgPolicy('rfqs_select_buyer_of_request', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.requestId} in (select id from ${requests})`,
    }),
    pgPolicy('rfqs_select_staff', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: staffOnly,
    }),
    pgPolicy('rfqs_update_own_supplier', {
      as: 'permissive',
      for: 'update',
      to: authenticatedRole,
      using: sql`${t.supplierCompanyId} = ${currentCompanyIdSubquery}`,
      withCheck: sql`${t.supplierCompanyId} = ${currentCompanyIdSubquery}`,
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
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    validUntil: date('valid_until'),
    currency: text('currency').notNull().default('KZT'),
    notes: text('notes'),
    source: quoteSourceEnum('source').notNull().default('form'),
    fileUrl: text('file_url'),
    ...timestamps,
  },
  (t) => [
    index('quotes_rfq_id_idx').on(t.rfqId),
    // Через rfq_id таблица уже наследует изоляцию поставщиков rfqs —
    // «свой RFQ» здесь означает и «своё quote».
    pgPolicy('quotes_select_own_supplier', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.rfqId} in (select id from ${rfqs} where supplier_company_id = ${currentCompanyIdSubquery})`,
    }),
    pgPolicy('quotes_select_buyer_of_request', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.rfqId} in (select id from ${rfqs} where request_id in (select id from ${requests}))`,
    }),
    pgPolicy('quotes_select_staff', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: staffOnly,
    }),
    pgPolicy('quotes_insert_own_supplier', {
      as: 'permissive',
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${t.rfqId} in (select id from ${rfqs} where supplier_company_id = ${currentCompanyIdSubquery})`,
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
          select id from ${rfqs} where supplier_company_id = ${currentCompanyIdSubquery}
        )
      )`,
    }),
    pgPolicy('quote_lines_select_buyer_of_request', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.quoteId} in (
        select id from ${quotes} where rfq_id in (
          select id from ${rfqs} where request_id in (select id from ${requests})
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
    totalKzt: bigint('total_kzt', { mode: 'number' }).notNull(),
    etaDate: date('eta_date'),
    slackDays: integer('slack_days'),
    supplierCount: integer('supplier_count').notNull(),
    explanation: jsonb('explanation').notNull(),
    status: planStatusEnum('status').notNull().default('draft'),
    ...timestamps,
  },
  (t) => [
    index('plans_request_id_idx').on(t.requestId),
    pgPolicy('plans_select_via_request', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.requestId} in (select id from ${requests})`,
    }),
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
    ...timestamps,
  },
  (t) => [
    index('plan_lines_plan_id_idx').on(t.planId),
    index('plan_lines_request_item_id_idx').on(t.requestItemId),
    index('plan_lines_supplier_company_id_idx').on(t.supplierCompanyId),
    index('plan_lines_quote_line_id_idx').on(t.quoteLineId),
    pgPolicy('plan_lines_select_via_plan', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.planId} in (select id from ${plans})`,
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
      using: sql`${t.requestId} in (select id from ${requests})`,
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
      using: sql`${t.requestId} in (select id from ${requests})`,
    }),
    // Заказ виден и поставщикам, чьи строки вошли в утверждённый план.
    pgPolicy('orders_select_supplier_in_plan', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.approvedPlanId} in (
        select plan_id from ${planLines} where supplier_company_id = ${currentCompanyIdSubquery}
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
    // Audit log только на вставку через движок — никаких direct update/delete
    // даже для service_role, история необратима (agents.md §6).
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
    index('supplier_payouts_order_id_idx').on(t.orderId),
    index('supplier_payouts_supplier_company_id_idx').on(t.supplierCompanyId),
    pgPolicy('supplier_payouts_select_own_supplier', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.supplierCompanyId} = ${currentCompanyIdSubquery}`,
    }),
    pgPolicy('supplier_payouts_select_staff', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: staffOnly,
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
    pgPolicy('documents_select_via_order', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.orderId} in (select id from ${orders})`,
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
