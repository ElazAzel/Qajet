import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole, authUid, serviceRole } from 'drizzle-orm/supabase';
import { id, timestamps } from './_columns.js';
import { changeRequestStatusEnum, threadKindEnum } from './enums.js';
import { companies, currentCompanyIdSubquery, currentRoleSubquery, users } from './identity.js';
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
    uniqueIndex('threads_request_buyer_unique')
      .on(t.requestId)
      .where(sql`${t.requestId} is not null and ${t.kind} = 'buyer'`),
    uniqueIndex('threads_request_internal_unique')
      .on(t.requestId)
      .where(sql`${t.requestId} is not null and ${t.kind} = 'internal'`),
    uniqueIndex('threads_order_buyer_unique')
      .on(t.orderId)
      .where(sql`${t.orderId} is not null and ${t.kind} = 'buyer'`),
    uniqueIndex('threads_order_internal_unique')
      .on(t.orderId)
      .where(sql`${t.orderId} is not null and ${t.kind} = 'internal'`),
    uniqueIndex('threads_order_supplier_unique')
      .on(t.orderId, t.supplierCompanyId)
      .where(sql`${t.orderId} is not null and ${t.kind} = 'supplier'`),
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
      using: sql`${t.kind} = 'buyer' and exists (
        select 1 from ${companies} c where c.id = ${currentCompanyIdSubquery} and c.type = 'buyer'
      ) and (
        ${t.requestId} in (select id from ${requests}) or
        ${t.orderId} in (select id from ${orders})
      )`,
    }),
    pgPolicy('threads_select_own_supplier', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.kind} = 'supplier' and ${t.supplierCompanyId} = ${currentCompanyIdSubquery} and (
        ${currentRoleSubquery} = 'owner' or public.supplier_can_access_order(${t.orderId})
      )`,
    }),
    pgPolicy('threads_insert_buyer_own', {
      as: 'permissive',
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${t.kind} = 'buyer' and ${t.supplierCompanyId} is null and exists (
        select 1 from ${companies} c where c.id = ${currentCompanyIdSubquery} and c.type = 'buyer'
      ) and (
        ${t.requestId} in (select id from ${requests}) or ${t.orderId} in (select id from ${orders})
      )`,
    }),
    pgPolicy('threads_insert_staff', {
      as: 'permissive',
      for: 'insert',
      to: authenticatedRole,
      withCheck: staffOnly,
    }),
    pgPolicy('threads_update_staff', {
      as: 'permissive',
      for: 'update',
      to: authenticatedRole,
      using: staffOnly,
      withCheck: staffOnly,
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
    check('messages_body_valid', sql`length(trim(${t.body})) between 1 and 10000`),
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
    pgPolicy('messages_update_own', {
      as: 'permissive',
      for: 'update',
      to: authenticatedRole,
      using: sql`${t.authorUserId} = ${authUid} and ${t.threadId} in (select id from ${threads})`,
      withCheck: sql`${t.authorUserId} = ${authUid} and ${t.threadId} in (select id from ${threads})`,
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

/** Последняя прочитанная точка треда — один timestamp на пользователя, без
 * массового флага read на каждом сообщении. RLS наследует видимость самого
 * треда и не позволяет отмечать чужую переписку прочитанной. */
export const threadReads = pgTable(
  'thread_reads',
  {
    id: id(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('thread_reads_thread_user_unique').on(t.threadId, t.userId),
    index('thread_reads_user_id_idx').on(t.userId),
    pgPolicy('thread_reads_select_own', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid} and ${t.threadId} in (select id from ${threads})`,
    }),
    pgPolicy('thread_reads_insert_own', {
      as: 'permissive',
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${t.userId} = ${authUid} and ${t.threadId} in (select id from ${threads})`,
    }),
    pgPolicy('thread_reads_update_own', {
      as: 'permissive',
      for: 'update',
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid} and ${t.threadId} in (select id from ${threads})`,
      withCheck: sql`${t.userId} = ${authUid} and ${t.threadId} in (select id from ${threads})`,
    }),
    pgPolicy('thread_reads_service_all', {
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
      using: sql`${t.orderId} in (
        select o.id from ${orders} o join ${requests} r on r.id = o.request_id
        where r.buyer_company_id = ${currentCompanyIdSubquery}
      ) or ${staffOnly}`,
    }),
    pgPolicy('change_requests_insert_buyer', {
      as: 'permissive',
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${t.initiatorUserId} = ${authUid} and ${t.orderId} in (
        select o.id from ${orders} o join ${requests} r on r.id = o.request_id
        where r.buyer_company_id = ${currentCompanyIdSubquery}
      )`,
    }),
    pgPolicy('change_requests_update_staff', {
      as: 'permissive',
      for: 'update',
      to: authenticatedRole,
      using: staffOnly,
      withCheck: staffOnly,
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

/** Файлы, связанные с заявкой, заказом, тредом или сообщением. Объект в
 * private storage никогда не выдаётся только по непрозрачному ID: RLS на
 * этой таблице проверяет тот же контекст участия, что и рабочие данные. */
export const attachments = pgTable(
  'attachments',
  {
    id: id(),
    requestId: uuid('request_id').references(() => requests.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id').references(() => threads.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'cascade' }),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    objectKey: text('object_key').notNull().unique(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    kind: text('kind').notNull().default('attachment'),
    ...timestamps,
  },
  (t) => [
    check(
      'attachments_context_present',
      sql`num_nonnulls(${t.requestId}, ${t.orderId}, ${t.threadId}, ${t.messageId}) > 0`,
    ),
    check('attachments_size_positive', sql`${t.sizeBytes} > 0`),
    index('attachments_request_id_idx').on(t.requestId),
    index('attachments_order_id_idx').on(t.orderId),
    index('attachments_thread_id_idx').on(t.threadId),
    index('attachments_message_id_idx').on(t.messageId),
    pgPolicy('attachments_select_staff', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: staffOnly,
    }),
    pgPolicy('attachments_select_buyer', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.kind} <> 'supplier_invoice' and exists (
        select 1 from ${companies} c where c.id = ${currentCompanyIdSubquery} and c.type = 'buyer'
      ) and (
        ${t.requestId} in (select id from ${requests}) or
        ${t.orderId} in (select id from ${orders}) or
        ${t.threadId} in (select id from ${threads} where kind = 'buyer') or
        ${t.messageId} in (select m.id from ${messages} m join ${threads} th on th.id = m.thread_id where th.kind = 'buyer')
      )`,
    }),
    pgPolicy('attachments_select_supplier', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`(
        ${t.threadId} in (select id from ${threads} where kind = 'supplier' and supplier_company_id = ${currentCompanyIdSubquery}) or
        ${t.messageId} in (select m.id from ${messages} m join ${threads} th on th.id = m.thread_id where th.kind = 'supplier' and th.supplier_company_id = ${currentCompanyIdSubquery}) or
        (${t.orderId} is not null and public.supplier_can_access_order(${t.orderId}))
      )`,
    }),
    pgPolicy('attachments_insert_staff', {
      as: 'permissive',
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${t.uploadedBy} = ${authUid} and ${staffOnly}`,
    }),
    pgPolicy('attachments_insert_buyer', {
      as: 'permissive',
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${t.uploadedBy} = ${authUid} and exists (
        select 1 from ${companies} c where c.id = ${currentCompanyIdSubquery} and c.type = 'buyer'
      ) and (
        ${t.requestId} in (select id from ${requests}) or
        ${t.orderId} in (select id from ${orders}) or
        ${t.threadId} in (select id from ${threads} where kind = 'buyer') or
        ${t.messageId} in (select m.id from ${messages} m join ${threads} th on th.id = m.thread_id where th.kind = 'buyer')
      )`,
    }),
    pgPolicy('attachments_insert_supplier', {
      as: 'permissive',
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${t.uploadedBy} = ${authUid} and ${currentRoleSubquery} in ('owner', 'manager') and (
        ${t.threadId} in (select id from ${threads} where kind = 'supplier' and supplier_company_id = ${currentCompanyIdSubquery}) or
        ${t.messageId} in (select m.id from ${messages} m join ${threads} th on th.id = m.thread_id where th.kind = 'supplier' and th.supplier_company_id = ${currentCompanyIdSubquery}) or
        (${t.orderId} is not null and public.supplier_can_access_order(${t.orderId}))
      )`,
    }),
    pgPolicy('attachments_delete_staff', {
      as: 'permissive',
      for: 'delete',
      to: authenticatedRole,
      using: staffOnly,
    }),
    pgPolicy('attachments_service_all', {
      as: 'permissive',
      for: 'all',
      to: serviceRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();
