import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole, serviceRole } from 'drizzle-orm/supabase';
import { id, timestamps } from './_columns.js';
import { aliasKindEnum, modelNameEnum, timeEntryStageEnum } from './enums.js';
import { companies, currentCompanyIdSubquery, currentRoleSubquery, users } from './identity.js';
import { orders } from './procurement.js';

/**
 * Учёт времени и контур обучения — agents.md §8G, §9. Всё здесь либо
 * внутренняя аналитика QAJET (staff-only), либо пишется исключительно
 * движком (service_role) и никогда напрямую клиентом — обучение должно
 * идти по фактам заказов, а не по тому, что клиент сам о себе впишет.
 */

const staffOnly = sql`${currentRoleSubquery} in ('concierge', 'admin')`;

export const timeEntries = pgTable(
  'time_entries',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    stage: timeEntryStageEnum('stage').notNull(),
    seconds: integer('seconds').notNull(),
    source: text('source').notNull().default('auto'),
    ...timestamps,
  },
  (t) => [
    index('time_entries_order_id_idx').on(t.orderId),
    index('time_entries_user_id_idx').on(t.userId),
    pgPolicy('time_entries_select_staff', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: staffOnly,
    }),
    pgPolicy('time_entries_insert_own', {
      as: 'permissive',
      for: 'insert',
      to: authenticatedRole,
      withCheck: staffOnly,
    }),
    pgPolicy('time_entries_service_all', {
      as: 'permissive',
      for: 'all',
      to: serviceRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();

/** Сюда пишется всё, из чего система учится — agents.md §5. Только движок. */
export const learningEvents = pgTable(
  'learning_events',
  {
    id: id(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  () => [
    pgPolicy('learning_events_select_staff', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: staffOnly,
    }),
    // Консьерж пишет сюда сам при исправлении классификации позиции
    // (agents.md §8A) — не через service_role, тем же приёмом, что и
    // остальные staff-действия в схеме.
    pgPolicy('learning_events_insert_staff', {
      as: 'permissive',
      for: 'insert',
      to: authenticatedRole,
      withCheck: staffOnly,
    }),
    pgPolicy('learning_events_service_all', {
      as: 'permissive',
      for: 'all',
      to: serviceRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();

/** Топливо для калькулятора — agents.md §8B. */
export const priceObservations = pgTable(
  'price_observations',
  {
    id: id(),
    category: text('category').notNull(),
    itemKey: text('item_key').notNull(),
    qty: integer('qty').notNull(),
    unitPriceKzt: bigint('unit_price_kzt', { mode: 'number' }).notNull(),
    supplierCompanyId: uuid('supplier_company_id').references(() => companies.id, {
      onDelete: 'set null',
    }),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('price_observations_supplier_company_id_idx').on(t.supplierCompanyId),
    pgPolicy('price_observations_select_staff', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: staffOnly,
    }),
    pgPolicy('price_observations_service_all', {
      as: 'permissive',
      for: 'all',
      to: serviceRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();

export const extractionAliases = pgTable(
  'extraction_aliases',
  {
    id: id(),
    alias: text('alias').notNull(),
    canonical: text('canonical').notNull(),
    kind: aliasKindEnum('kind').notNull(),
    hits: integer('hits').notNull().default(1),
    confirmedBy: uuid('confirmed_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('extraction_aliases_confirmed_by_idx').on(t.confirmedBy),
    pgPolicy('extraction_aliases_select_staff', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: staffOnly,
    }),
    // Апсерт (insert новой строки / update счётчика hits) при каждом
    // исправлении консьержа — agents.md §8A: «hits ≥ 3 начинает
    // применяться автоматически».
    pgPolicy('extraction_aliases_insert_staff', {
      as: 'permissive',
      for: 'insert',
      to: authenticatedRole,
      withCheck: staffOnly,
    }),
    pgPolicy('extraction_aliases_update_staff', {
      as: 'permissive',
      for: 'update',
      to: authenticatedRole,
      using: staffOnly,
      withCheck: staffOnly,
    }),
    pgPolicy('extraction_aliases_service_all', {
      as: 'permissive',
      for: 'all',
      to: serviceRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();

/** Версии моделей — agents.md §8G: «версии моделей хранятся, чтобы показать обучение во времени». */
export const modelSnapshots = pgTable(
  'model_snapshots',
  {
    id: id(),
    model: modelNameEnum('model').notNull(),
    params: jsonb('params').notNull(),
    metrics: jsonb('metrics').notNull(),
    trainedAt: timestamp('trained_at', { withTimezone: true }).notNull().defaultNow(),
    nSamples: integer('n_samples').notNull(),
  },
  () => [
    // /admin/learning — экран для жюри и админа, staff-only (agents.md §10).
    pgPolicy('model_snapshots_select_staff', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: staffOnly,
    }),
    pgPolicy('model_snapshots_service_all', {
      as: 'permissive',
      for: 'all',
      to: serviceRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();

export const ratings = pgTable(
  'ratings',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    supplierCompanyId: uuid('supplier_company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    buyerScore1To5: integer('buyer_score_1_5').notNull(),
    wasOnTime: boolean('was_on_time').notNull(),
    hadDispute: boolean('had_dispute').notNull().default(false),
    comment: text('comment'),
    ...timestamps,
  },
  (t) => [
    index('ratings_order_id_idx').on(t.orderId),
    index('ratings_supplier_company_id_idx').on(t.supplierCompanyId),
    pgPolicy('ratings_select_staff', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: staffOnly,
    }),
    pgPolicy('ratings_select_own_supplier', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.supplierCompanyId} = ${currentCompanyIdSubquery}`,
    }),
    pgPolicy('ratings_select_via_order', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.orderId} in (select id from ${orders})`,
    }),
    pgPolicy('ratings_insert_via_order', {
      as: 'permissive',
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${t.orderId} in (select id from ${orders})`,
    }),
    pgPolicy('ratings_service_all', {
      as: 'permissive',
      for: 'all',
      to: serviceRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();

/** Комиссия, минимум, база комиссии, пороги — agents.md §5. Настраивает только админ. */
export const settings = pgTable(
  'settings',
  {
    key: text('key').primaryKey(),
    value: jsonb('value').notNull(),
    updatedAt: timestamps.updatedAt,
  },
  () => [
    pgPolicy('settings_select_staff', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: staffOnly,
    }),
    pgPolicy('settings_service_all', {
      as: 'permissive',
      for: 'all',
      to: serviceRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();
