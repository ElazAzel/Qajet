import { readFileSync, writeFileSync } from 'node:fs';
import { generateSeedDataset, type SeedDataset } from '../src/seed/generator.js';

/**
 * Разовый инструмент: генерирует сид и печатает его как SQL INSERT-строки
 * вместо того, чтобы вставлять напрямую через Drizzle/postgres.js — для
 * сессий без DATABASE_URL, где применение идёт через Supabase MCP
 * (`execute_sql`) внешним оркестратором, а не отсюда напрямую.
 *
 * Не часть `pnpm db:seed` — тот использует index.ts с настоящим соединением.
 * Запуск: `tsx packages/db/scripts/dump-seed-sql.ts <existing.json> <outDir>`.
 */

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (Array.isArray(value)) {
    if (value.length === 0) return "'{}'::text[]";
    const items = value.map((v) => `"${String(v).replace(/"/g, '\\"')}"`).join(',');
    return `'{${items}}'::text[]`;
  }
  if (typeof value === 'object') {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function toSnake(key: string): string {
  return key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

function tableInsertSql(
  table: string,
  rows: readonly Record<string, unknown>[],
  batchSize = 200,
): string {
  if (rows.length === 0) return '';
  const columns = Object.keys(rows[0] as Record<string, unknown>);
  const stmts: string[] = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const values = chunk
      .map((row) => `  (${columns.map((c) => sqlLiteral(row[c])).join(', ')})`)
      .join(',\n');
    stmts.push(
      `insert into public.${table} (${columns.map(toSnake).join(', ')}) values\n${values};`,
    );
  }
  return stmts.join('\n\n');
}

const existingArg = process.argv[2];
const outDir = process.argv[3] ?? '.';
if (!existingArg || !outDir) {
  console.error('Usage: tsx dump-seed-sql.ts <existing.json> <outDir>');
  process.exit(1);
}

const existingRaw = JSON.parse(readFileSync(existingArg, 'utf8'));
const dataset: SeedDataset = generateSeedDataset({
  seed: 1,
  referenceDateIso: new Date().toISOString().slice(0, 10),
  existing: existingRaw,
});

// manager@demo.qajet.kz: auth.users уже создан отдельным SQL (клон пароля buyer),
// но public.users — ещё нет. Ничего в графе не ссылается на этот id снаружи
// собственной строки users, поэтому точечная подмена безопасна.
const NEW_MANAGER_AUTH_ID = process.env.SEED_MANAGER_USER_ID;
if (NEW_MANAGER_AUTH_ID) {
  const managerUser = dataset.users.find((u) => u.email === 'manager@demo.qajet.kz');
  const managerAccount = dataset.accounts.find((a) => a.email === 'manager@demo.qajet.kz');
  if (managerUser) managerUser.id = NEW_MANAGER_AUTH_ID;
  if (managerAccount) managerAccount.userId = NEW_MANAGER_AUTH_ID;
}

const tableOrder: [string, keyof SeedDataset][] = [
  ['settings', 'settings'],
  ['companies', 'companies'],
  ['users', 'users'],
  ['supplier_profiles', 'supplierProfiles'],
  ['supplier_stats', 'supplierStats'],
  ['requests', 'requests'],
  ['request_items', 'requestItems'],
  ['estimates', 'estimates'],
  ['prepayments', 'prepayments'],
  ['rfqs', 'rfqs'],
  ['quotes', 'quotes'],
  ['quote_lines', 'quoteLines'],
  ['plans', 'plans'],
  ['plan_lines', 'planLines'],
  ['plan_rejections', 'planRejections'],
  ['orders', 'orders'],
  ['order_stage_events', 'orderStageEvents'],
  ['supplier_payouts', 'supplierPayouts'],
  ['documents', 'documents'],
  ['ratings', 'ratings'],
  ['learning_events', 'learningEvents'],
  ['price_observations', 'priceObservations'],
  ['model_snapshots', 'modelSnapshots'],
];

for (const [table, key] of tableOrder) {
  const rows = dataset[key] as unknown as Record<string, unknown>[];
  // settings.value — jsonb, но хранит примитивы (числа, строки), не объекты:
  // общий сериализатор угадывает jsonb только по typeof === 'object', поэтому
  // здесь нужен явный JSON.stringify независимо от типа значения.
  const normalizedRows =
    table === 'settings'
      ? rows.map((r) => ({ ...r, value: { __jsonbLiteral: JSON.stringify(r.value) } }))
      : rows;
  const sql =
    table === 'settings'
      ? normalizedRows
          .map(
            (r) =>
              `insert into public.settings (key, value) values (${sqlLiteral(r.key)}, '${(r.value as { __jsonbLiteral: string }).__jsonbLiteral.replace(/'/g, "''")}'::jsonb);`,
          )
          .join('\n')
      : tableInsertSql(table, rows);
  writeFileSync(`${outDir}/${String(key)}.sql`, sql, 'utf8');
  console.log(`${table}: ${rows.length} rows`);
}

writeFileSync(`${outDir}/accounts.json`, JSON.stringify(dataset.accounts, null, 2), 'utf8');
console.log('accounts:', dataset.accounts.length);
