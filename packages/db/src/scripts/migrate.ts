import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/**
 * Применяет `packages/db/migrations/*.sql` (сгенерированные `drizzle-kit
 * generate`) к живому Postgres по `DATABASE_URL` — локальному
 * (`supabase start`, порт 54322 по умолчанию) или CI-инстансу Supabase CLI.
 *
 * Раньше миграции применялись только через Supabase MCP (`apply_migration`)
 * — см. комментарий в `drizzle.config.ts` — потому что в песочнице
 * разработки прямой TCP до Postgres не гарантирован через прокси. В CI
 * (GitHub Actions) такого ограничения нет, а обязательный тест изоляции
 * поставщиков (`__tests__/supplier-isolation.test.ts`) требует реальной
 * базы с применёнными миграциями — отсюда этот скрипт.
 */

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL не задан — нечего применять миграции.');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1, prepare: false });
const db = drizzle(sql);

await migrate(db, {
  migrationsFolder: fileURLToPath(new URL('../../migrations', import.meta.url)),
});
await sql.end();

console.log('Миграции применены.');
