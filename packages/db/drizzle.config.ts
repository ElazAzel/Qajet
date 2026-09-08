import { defineConfig } from 'drizzle-kit';

/**
 * `drizzle-kit generate` не требует живого соединения — оно читает схему
 * из TypeScript и сравнивает со снапшотом в migrations/meta. Применение —
 * либо `pnpm db:migrate` (src/scripts/migrate.ts, требует DATABASE_URL:
 * локальный `supabase start` или CI), либо через Supabase MCP
 * (apply_migration) для боевого проекта — так надёжнее в песочнице
 * разработки, где прямой TCP до Postgres не гарантирован через прокси.
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
