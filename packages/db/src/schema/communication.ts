import { sql } from 'drizzle-orm';
import { index, jsonb, pgPolicy, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { authenticatedRole, authUid, serviceRole } from 'drizzle-orm/supabase';
import { id, timestamps } from './_columns.js';
import { changeRequestStatusEnum, threadKindEnum } from './enums.js';
import { currentCompanyIdSubquery, currentRoleSubquery, users } from './identity.js';
import { orders, plans, requests } from './procurement.js';

const staffOnly = sql`${currentRoleSubquery} in ('concierge', 'admin')`;

/**
 * Треды переписки — agents.md §5, §3.5: «Консьерж видит заказ целиком со
 * всеми тредами. Внутренние заметки видны только сотрудникам QAJET.»
 * `kind = 'internal'` физически недоступен покупателю/поставщику через RLS,
 * а не скрывается только в интерфейсе.
 */
export const threads = pgTable(
  'threads',
  {
    id: id(),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'cascade' }),
    requestId: uuid('request_id').references(() => requests.id, { onDelete: 'cascade' }),
    kind: threadKindEnum('kind').notNull(),
    supplierCompanyId: uuid('supplier_company_id'),
    ...timestamps,
  },
  (t) => [
    index('threads_order_id_idx').on(t.orderId),
    index('threads_request_id_idx').on(t.requestId),
    pgPolicy('threads_select_staff', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: staffOnly,
    }),
    pgPolicy('threads_select_buyer', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.kind} = 'buyer' and (
        ${t.requestId} in (select id from ${requests}) or
        ${t.orderId} in (select id from ${orders})
      )`,
    }),
    pgPolicy('threads_select_own_supplier', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.kind} = 'supplier' and ${t.supplierCompanyId} = ${currentCompanyIdSubquery}`,
    }),
    pgPolicy('threads_service_all', {
      as: 'permissive',
      for: 'all',
      to: serviceRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();

export const messages = pgTable(
  'messages',
  {
    id: id(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    attachments: jsonb('attachments').notNull().default([]),
    changeRequestId: uuid('change_request_id'),
    ...timestamps,
  },
  (t) => [
    index('messages_thread_id_idx').on(t.threadId),
    index('messages_author_user_id_idx').on(t.authorUserId),
    // Видимость сообщения полностью наследуется от видимости треда —
    // отдельной политики «своё сообщение» не нужно, доступ к треду уже
    // означает доступ ко всей его истории (agents.md §3: история не режется).
    pgPolicy('messages_select_via_thread', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.threadId} in (select id from ${threads})`,
    }),
    pgPolicy('messages_insert_via_thread', {
      as: 'permissive',
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${t.threadId} in (select id from ${threads}) and ${t.authorUserId} = (select id from ${users} where id = ${authUid})`,
    }),
    pgPolicy('messages_service_all', {
      as: 'permissive',
      for: 'all',
      to: serviceRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();

export const changeRequests = pgTable(
  'change_requests',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    proposedPlanId: uuid('proposed_plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    initiatorUserId: uuid('initiator_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    diff: jsonb('diff').notNull(),
    status: changeRequestStatusEnum('status').notNull().default('pending'),
    ...timestamps,
  },
  (t) => [
    index('change_requests_order_id_idx').on(t.orderId),
    index('change_requests_proposed_plan_id_idx').on(t.proposedPlanId),
    index('change_requests_initiator_user_id_idx').on(t.initiatorUserId),
    pgPolicy('change_requests_select_via_order', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.orderId} in (select id from ${orders})`,
    }),
    pgPolicy('change_requests_service_all', {
      as: 'permissive',
      for: 'all',
      to: serviceRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();
