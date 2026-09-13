import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole, authUid, authUsers, serviceRole } from 'drizzle-orm/supabase';
import { id, timestamps } from './_columns.js';
import { companyTypeEnum, taxModeEnum, userRoleEnum, vatStatusEnum } from './enums.js';

/**
 * Идентичность и компании — agents.md §5, §3.
 *
 * Изоляция поставщиков (agents.md §3.4, обязательный тест §15) начинается
 * здесь: policies ниже читают `company_id`/`role` текущего пользователя через
 * `currentCompanyIdSubquery`/`currentRoleSubquery` (см. ниже) — оба
 * определены как `(select public.current_*())`, не голый вызов функции.
 * Обёртка в `(select ...)` — приём из drizzle-orm/supabase для
 * производительности: STABLE-функция внутри вычисляется планировщиком один
 * раз на statement (InitPlan), а не на каждой просканированной строке.
 */

export const companies = pgTable(
  'companies',
  {
    id: id(),
    type: companyTypeEnum('type').notNull(),
    name: text('name').notNull(),
    bin: text('bin'),
    taxMode: taxModeEnum('tax_mode').notNull().default('unknown'),
    vatStatus: vatStatusEnum('vat_status').notNull().default('unknown'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verificationNote: text('verification_note'),
    city: text('city'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  () => [
    // Любой аутентифицированный пользователь видит только свою компанию.
    // Консьерж/админ видят все — это накрывается отдельной policy ниже,
    // а не размыванием этой: разрешительные (permissive) policy для одной
    // роли складываются через OR, поэтому обе применяются одновременно.
    pgPolicy('companies_select_own', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`id = ${currentCompanyIdSubquery}`,
    }),
    pgPolicy('companies_select_staff', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${currentRoleSubquery} in ('concierge', 'admin')`,
    }),
    // Поставщик видит карточку компании-покупателя только если ему по её
    // заявке отправили RFQ — иначе он не узнал бы, кому отвечает. Через
    // SECURITY DEFINER-функцию (buyerCompanyIdsForCurrentSupplierSubquery,
    // объявлена ниже в этом файле), а не подзапрос напрямую в "requests"/
    // "rfqs": requests_select_supplier_via_rfq и rfqs_select_buyer_of_request
    // (procurement.ts) сами транзитивно проходят друг через друга, и прямой
    // подзапрос отсюда замкнул бы цикл через них в ERROR 42P17 (см. комментарий
    // у самой константы).
    pgPolicy('companies_select_supplier_via_rfq', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`id in (select ${buyerCompanyIdsForCurrentSupplierSubquery})`,
    }),
    pgPolicy('companies_update_staff', {
      as: 'permissive',
      for: 'update',
      to: authenticatedRole,
      using: sql`${currentRoleSubquery} in ('concierge', 'admin')`,
      withCheck: sql`${currentRoleSubquery} in ('concierge', 'admin')`,
    }),
    pgPolicy('companies_service_all', {
      as: 'permissive',
      for: 'all',
      to: serviceRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();

export const users = pgTable(
  'users',
  {
    // Совпадает с auth.users.id — Supabase Auth создаёт запись, приложение
    // добавляет профиль тем же id. Без отдельного serial/uuid по умолчанию.
    id: uuid('id')
      .primaryKey()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    // Nullable: консьерж и админ — сотрудники самой платформы QAJET, а не
    // buyer/supplier-компании (companies.type ограничен этими двумя видами
    // по agents.md §5). Для owner/manager company_id обязателен на уровне
    // приложения, но в БД это не проверить constraint'ом без отдельной
    // сущности «компания QAJET», которую спека не заводит.
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'restrict' }),
    email: text('email').notNull(),
    fullName: text('full_name').notNull(),
    role: userRoleEnum('role').notNull(),
    approvalLimitKzt: bigint('approval_limit_kzt', { mode: 'number' }),
    isActive: boolean('is_active').notNull().default(true),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check(
      'users_approval_limit_nonnegative',
      sql`${t.approvalLimitKzt} is null or ${t.approvalLimitKzt} >= 0`,
    ),
    index('users_company_id_idx').on(t.companyId),
    // Своя запись — всегда видна, это и есть точка входа для company_id/role
    // подзапросов у всех остальных таблиц.
    pgPolicy('users_select_self', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.id} = ${authUid}`,
    }),
    // Коллеги по компании видны друг другу (агентс.md §3: руководитель
    // видит активность компании, менеджер работает в её же рамках).
    pgPolicy('users_select_same_company', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.companyId} = ${currentCompanyIdSubquery}`,
    }),
    pgPolicy('users_select_staff', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${currentRoleSubquery} in ('concierge', 'admin')`,
    }),
    pgPolicy('users_service_all', {
      as: 'permissive',
      for: 'all',
      to: serviceRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();

/** Оверрайды поверх роли — agents.md §3: «role + permissions с оверрайдами». */
export const permissions = pgTable(
  'permissions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    ...timestamps,
  },
  (t) => [
    index('permissions_user_id_idx').on(t.userId),
    pgPolicy('permissions_select_own_company', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} in (select id from ${users} where company_id = ${currentCompanyIdSubquery})`,
    }),
    // Права сотрудникам выдаёт и отзывает владелец компании (agents.md §10
    // «Команда и доступы»). Менеджер видит доступы коллег (политика выше),
    // но менять их не может — иначе «лимит согласования» не ограничение, а
    // приглашение поднять себе лимит самому.
    pgPolicy('permissions_insert_owner', {
      as: 'permissive',
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${currentRoleSubquery} = 'owner' and ${t.userId} in (select id from ${users} where company_id = ${currentCompanyIdSubquery})`,
    }),
    pgPolicy('permissions_update_owner', {
      as: 'permissive',
      for: 'update',
      to: authenticatedRole,
      using: sql`${currentRoleSubquery} = 'owner' and ${t.userId} in (select id from ${users} where company_id = ${currentCompanyIdSubquery})`,
    }),
    pgPolicy('permissions_service_all', {
      as: 'permissive',
      for: 'all',
      to: serviceRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();

export const supplierProfiles = pgTable(
  'supplier_profiles',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' })
      .unique(),
    categories: text('categories').array().notNull().default(sql`'{}'::text[]`),
    capabilities: text('capabilities').array().notNull().default(sql`'{}'::text[]`),
    /** Пустой список означает «доставляем в любой город»; непустой — явная зона. */
    serviceCities: text('service_cities').array().notNull().default(sql`'{}'::text[]`),
    minOrderKzt: bigint('min_order_kzt', { mode: 'number' }),
    leadTimeDaysDefault: integer('lead_time_days_default'),
    portfolioUrls: text('portfolio_urls').array().notNull().default(sql`'{}'::text[]`),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [
    // Личность/профиль поставщика покупателю не раскрывается — agents.md §10
    // «Покупатель»/«Поставщик»: с точки зрения покупателя поставщик — сам
    // QAJET, реальный исполнитель невидим. Профиль читают только сам
    // поставщик (свой) и staff (подбор, экран сравнения консьержа).
    pgPolicy('supplier_profiles_select_all', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.companyId} = ${currentCompanyIdSubquery} or ${currentRoleSubquery} in ('concierge', 'admin')`,
    }),
    pgPolicy('supplier_profiles_update_own', {
      as: 'permissive',
      for: 'update',
      to: authenticatedRole,
      using: sql`${t.companyId} = ${currentCompanyIdSubquery}`,
      withCheck: sql`${t.companyId} = ${currentCompanyIdSubquery}`,
    }),
    pgPolicy('supplier_profiles_service_all', {
      as: 'permissive',
      for: 'all',
      to: serviceRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();

/** Калибровка матчера — agents.md §8C, §8F. Пишет только движок (service_role). */
export const supplierStats = pgTable(
  'supplier_stats',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' })
      .unique(),
    ordersTotal: integer('orders_total').notNull().default(0),
    ordersOnTime: integer('orders_on_time').notNull().default(0),
    ordersDisputed: integer('orders_disputed').notNull().default(0),
    avgBuyerScore: integer('avg_buyer_score'),
    rfqSent: integer('rfq_sent').notNull().default(0),
    rfqAnswered: integer('rfq_answered').notNull().default(0),
    medianResponseHours: integer('median_response_hours'),
    leadTimeMultiplier: integer('lead_time_multiplier'),
    ...timestamps,
  },
  (t) => [
    // Тот же принцип, что и supplier_profiles: покупателю личность/показатели
    // поставщика не видны, только сам поставщик (свой дашборд роста) и staff.
    pgPolicy('supplier_stats_select_all', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.companyId} = ${currentCompanyIdSubquery} or ${currentRoleSubquery} in ('concierge', 'admin')`,
    }),
    pgPolicy('supplier_stats_service_all', {
      as: 'permissive',
      for: 'all',
      to: serviceRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();

/**
 * Текущий пользователь — вызовы SECURITY DEFINER функций, а не прямые
 * подзапросы в `users`. Раньше здесь были подзапросы вида
 * `(select company_id from users where id = auth.uid())`, и это ломало
 * саму `users`: её policy (`users_select_same_company`, `users_select_staff`)
 * используют эту же константу, то есть policy на `users` читает `users`,
 * что под ролью `authenticated` даёт `ERROR 42P17: infinite recursion
 * detected in policy for relation "users"` — не только на самой `users`, а
 * на любой таблице, чья policy транзитивно проходит через этот подзапрос.
 * `SECURITY DEFINER` функция выполняется с правами владельца (роль без RLS
 * на `users`), поэтому обращение к `users` внутри неё не запускает RLS
 * заново — цикл разрывается. Функции описаны как сырой SQL прямо в
 * сгенерированной миграции (см. `packages/db/migrations/*.sql`, блок
 * `CREATE OR REPLACE FUNCTION public.current_*`), а не через Drizzle-схему:
 * `pgPolicy` не умеет описывать `CREATE FUNCTION`. EXECUTE отозван у `anon`
 * и `public` — вызвать функцию напрямую через PostgREST RPC может только
 * `authenticated`/`service_role` (agents.md §3: доступ к `company_id`/`role`
 * своей же сессии не секрет для аутентифицированного пользователя, но не
 * должен быть открыт анониму).
 */
export const currentCompanyIdSubquery = sql`(select public.current_company_id())`;
export const currentRoleSubquery = sql`(select public.current_role())`;

/**
 * Тот же цикл, что описан выше для `users`, но между `requests` и `rfqs`:
 * `requests_select_supplier_via_rfq` (requests → rfqs) и
 * `rfqs_select_buyer_of_request` (rfqs → requests, миграция 0000) взаимно
 * подзапрашивали друг друга под ролью `authenticated` →
 * `ERROR 42P17: infinite recursion detected in policy for relation
 * "requests"` — ловилось на любом запросе, который тянет `companies` вместе
 * с ролью/компанией пользователя (`current-user.ts`), то есть буквально на
 * каждом заходе после логина. `SECURITY DEFINER`-функции ниже читают
 * `rfqs`/`requests` в обход их RLS, разрывая цикл — тот же приём, что и для
 * `current_company_id()`. Определены как сырой SQL прямо в сгенерированной
 * миграции (см. `packages/db/migrations/*.sql`, блок `CREATE OR REPLACE
 * FUNCTION public.rfq_request_ids_for_current_supplier` и соседний
 * `buyer_company_ids_for_current_supplier`), а не через Drizzle-схему.
 */
export const rfqRequestIdsForCurrentSupplierSubquery = sql`public.rfq_request_ids_for_current_supplier()`;
export const buyerCompanyIdsForCurrentSupplierSubquery = sql`public.buyer_company_ids_for_current_supplier()`;
