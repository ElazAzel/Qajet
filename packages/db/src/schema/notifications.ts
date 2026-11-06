import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { authenticatedRole, serviceRole } from 'drizzle-orm/supabase';
import { id, timestamps } from './_columns.js';
import { currentRoleSubquery } from './identity.js';

const staffOnly = sql`${currentRoleSubquery} in ('concierge', 'admin')`;

/**
 * Dev-first очередь исходящих уведомлений — agents.md §2 и §10.
 *
 * В development сообщение фиксируется здесь вместо обязательного Resend.
 * Позже worker может забрать pending-строки и отправить их через адаптер,
 * не меняя бизнес-действия. Клиенты не могут читать или отравлять очередь:
 * обычные уведомления доступны staff; owner invite со ссылкой входа — только
 * активному admin. service_role сохраняет доступ для фонового отправителя.
 */
export const outbox = pgTable(
  'outbox',
  {
    id: id(),
    channel: text('channel').notNull().default('email'),
    kind: text('kind').notNull(),
    recipient: text('recipient').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    payload: jsonb('payload').notNull().default({}),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    leaseId: text('lease_id'),
    leasedUntil: timestamp('leased_until', { withTimezone: true }),
    idempotencyKey: text('idempotency_key').notNull().default(sql`gen_random_uuid()::text`),
    providerMessageId: text('provider_message_id'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    deliveryError: text('delivery_error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('outbox_status_available_at_idx').on(t.status, t.availableAt),
    index('outbox_created_at_idx').on(t.createdAt),
    uniqueIndex('outbox_idempotency_key_idx').on(t.idempotencyKey),
    pgPolicy('outbox_select_staff', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${staffOnly} and (${t.kind} <> 'company_owner_invite' or ${currentRoleSubquery} = 'admin')`,
    }),
    pgPolicy('outbox_insert_staff', {
      as: 'permissive',
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${staffOnly} and (${t.kind} <> 'company_owner_invite' or ${currentRoleSubquery} = 'admin')`,
    }),
    pgPolicy('outbox_update_staff', {
      as: 'permissive',
      for: 'update',
      to: authenticatedRole,
      using: sql`${staffOnly} and (${t.kind} <> 'company_owner_invite' or ${currentRoleSubquery} = 'admin')`,
      withCheck: sql`${staffOnly} and (${t.kind} <> 'company_owner_invite' or ${currentRoleSubquery} = 'admin')`,
    }),
    pgPolicy('outbox_service_all', {
      as: 'permissive',
      for: 'all',
      to: serviceRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();
