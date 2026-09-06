import { defineConfig } from 'drizzle-kit';

/**
 * `drizzle-kit generate` не требует живого соединения — оно читает схему
 * из TypeScript и сравнивает со снапшотом в migrations/meta. Поэтому
 * миграции можно генерировать офлайн, а применять отдельно через
 * Supabase MCP (apply_migration) — так надёжнее в песочнице с прокси
 * на исходящий HTTPS, где прямой TCP до Postgres не гарантирован.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  },
  casing: 'snake_case',
});
