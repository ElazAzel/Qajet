import type { PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../schema/index.js';
import { SEED_ACCOUNTS } from '../seed/accounts.js';
import { generateSeedDataset, type SeedDataset } from '../seed/generator.js';
import { insertStatements, quote } from './_sql-literal.js';

/**
 * `pnpm db:dump-sql` — тот же сброс и пересев, что `db:reset`, но выведенный
 * SQL-текстом вместо прямого подключения. Нужен там, где `DATABASE_URL` нет
 * и быть не может: эта база с самого начала наполняется через MCP-коннектор
 * Supabase (у автора проекта нет ни прямого доступа к Postgres, ни
 * service-role-ключа локально), а `db:reset` требует TCP-подключения.
 *
 * Имена колонок берутся из самой схемы Drizzle (`getTableColumns`), а не
 * из camelCase→snake_case-конвертера: ровно на самодельном конвертере
 * прошлая версия этого инструмента дала `buyer_score1_to5` вместо
 * настоящего `buyer_score_1_5`, потому что схема переопределяет имя явно.
 *
 * Использование:
 *   pnpm db:dump-sql > /tmp/reset.sql
 *   pnpm db:dump-sql --existing-buyer-company=<uuid> --existing-user=email:<uuid> ...
 */

/** Таблицы, которые чистит `db:reset` — тот же порядок от детей к родителям. */
const TABLES_IN_DELETE_ORDER = [
  'messages',
  'threads',
  'change_requests',
  'time_entries',
  'learning_events',
  'model_snapshots',
  'price_observations',
  'ratings',
  'documents',
  'supplier_payouts',
  'order_stage_events',
  'orders',
  'plan_rejections',
  'plan_lines',
  'plans',
  'quote_lines',
  'quotes',
  'rfqs',
  'prepayments',
  'estimates',
  'request_items',
  'requests',
  'permissions',
  'supplier_stats',
  'supplier_profiles',
  'extraction_aliases',
  'settings',
] as const;

/** Порядок вставки — тот же, что в runSeed(), он следует внешним ключам. */
const INSERT_ORDER: readonly [keyof SeedDataset, PgTable][] = [
  ['settings', schema.settings],
  ['companies', schema.companies],
  ['users', schema.users],
  ['supplierProfiles', schema.supplierProfiles],
  ['supplierStats', schema.supplierStats],
  ['requests', schema.requests],
  ['requestItems', schema.requestItems],
  ['estimates', schema.estimates],
  ['prepayments', schema.prepayments],
  ['rfqs', schema.rfqs],
  ['quotes', schema.quotes],
  ['quoteLines', schema.quoteLines],
  ['plans', schema.plans],
  ['planLines', schema.planLines],
  ['planRejections', schema.planRejections],
  ['orders', schema.orders],
  ['orderStageEvents', schema.orderStageEvents],
  ['supplierPayouts', schema.supplierPayouts],
  ['documents', schema.documents],
  ['ratings', schema.ratings],
  ['learningEvents', schema.learningEvents],
  ['priceObservations', schema.priceObservations],
  ['modelSnapshots', schema.modelSnapshots],
  ['timeEntries', schema.timeEntries],
  ['threads', schema.threads],
  ['messages', schema.messages],
  ['permissions', schema.permissions],
  ['changeRequests', schema.changeRequests],
];

function parseArgs(): {
  buyerCompanyId?: string;
  supplierCompanyId?: string;
  users: Record<string, string>;
} {
  const users: Record<string, string> = {};
  let buyerCompanyId: string | undefined;
  let supplierCompanyId: string | undefined;
  for (const arg of process.argv.slice(2)) {
    const [flag, ...rest] = arg.split('=');
    const value = rest.join('=');
    if (flag === '--existing-buyer-company') buyerCompanyId = value;
    else if (flag === '--existing-supplier-company') supplierCompanyId = value;
    else if (flag === '--existing-user') {
      const idx = value.indexOf(':');
      const email = value.slice(0, idx);
      if (email) users[email] = value.slice(idx + 1);
    }
  }
  return {
    ...(buyerCompanyId && { buyerCompanyId }),
    ...(supplierCompanyId && { supplierCompanyId }),
    users,
  };
}

function main(): void {
  const args = parseArgs();
  const dataset = generateSeedDataset({
    seed: 1,
    referenceDateIso: new Date().toISOString().slice(0, 10),
    existing: {
      ...(args.buyerCompanyId ? { buyerCompanyId: args.buyerCompanyId } : {}),
      ...(args.supplierCompanyId ? { supplierCompanyId: args.supplierCompanyId } : {}),
      accountsByEmail: args.users,
    },
  });

  const lines: string[] = ['begin;'];
  for (const table of TABLES_IN_DELETE_ORDER) lines.push(`delete from "${table}";`);
  const keep = SEED_ACCOUNTS.map((a) => quote(a.email)).join(', ');
  lines.push(`delete from users where email not in (${keep});`);
  lines.push(
    'delete from companies where id not in (select company_id from users where company_id is not null);',
  );

  for (const [key, table] of INSERT_ORDER) {
    const rows = dataset[key] as readonly Record<string, unknown>[];
    lines.push(...insertStatements(table, rows));
  }
  lines.push('commit;');

  process.stdout.write(`${lines.join('\n')}\n`);

  const newAccounts = dataset.accounts.filter((a) => a.isNew);
  if (newAccounts.length > 0) {
    process.stderr.write(
      `ВНИМАНИЕ: ${newAccounts.length} аккаунтов помечены новыми — их нужно завести в auth.users отдельно (${newAccounts.map((a) => a.email).join(', ')}).\n`,
    );
  }
}

main();
