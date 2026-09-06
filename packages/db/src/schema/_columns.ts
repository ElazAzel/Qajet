import { timestamp, uuid } from 'drizzle-orm/pg-core';

/** Общие колонки — agents.md §5: «Все таблицы: id uuid pk, created_at, updated_at». */
export const id = () => uuid('id').primaryKey().defaultRandom();

export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};
