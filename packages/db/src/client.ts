import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

/**
 * Клиент Drizzle для серверного кода (Server Actions, Route Handlers).
 * Никогда не импортировать из клиентских компонентов — соединение с базой
 * живёт только на сервере (agents.md §11.1: единственная точка доступа).
 */
export function createDbClient(connectionString: string) {
  const client = postgres(connectionString, { prepare: false });
  return drizzle(client, { schema, casing: 'snake_case' });
}

export type Db = ReturnType<typeof createDbClient>;
export * as schema from './schema/index.js';
