import { sql } from 'drizzle-orm';
import { createDbClient } from '../client.js';
import { assertDemoDataAllowed, ENVIRONMENT_KIND_KEY, isLocalDatabaseUrl } from '../environment.js';
import { SEED_ACCOUNTS } from '../seed/accounts.js';
import { assertSeedEnv, runSeed } from '../seed/run.js';

/**
 * `pnpm db:reset` — agents.md §15, первый пункт чек-листа готовности:
 * «`pnpm i && pnpm db:reset && pnpm dev` поднимает заполненную систему без
 * единого внешнего ключа». До этого скрипта существовал только `db:seed`
 * (чистая вставка), поэтому повторный прогон против непустой базы удваивал
 * демо-историю, а восстановить протухшее демо было нечем — и оно протухло:
 * заказ на стадии `quotes_received`, вокруг которого построены §13 и экран
 * сравнения, израсходовался прогонами и в базе не осталось ни одного.
 *
 * Что НЕ удаляется: строки `users` пяти демо-аккаунтов и их компании.
 * `public.users.id` обязан совпадать с `auth.users.id`, а аккаунты в
 * GoTrue этот скрипт не трогает — снеся их здесь, мы получили бы новые id
 * при пересеве и рассинхрон с Auth. Ровно этот случай уже умеет
 * `generateSeedDataset({ existing })`, которым пользуется `runSeed()`.
 */

/** Порядок обязан идти от детей к родителям — внешние ключи без каскада. */
const TABLES_IN_DELETE_ORDER = [
  'outbox',
  'attachments',
  'messages',
  'threads',
  'change_requests',
  'time_entries',
  'learning_events',
  'model_snapshots',
  'price_observations',
  'ratings',
  'documents',
  'payment_facts',
  'supplier_payouts',
  'order_supplier_deliveries',
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

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'db:reset: не задан DATABASE_URL. Локально это `supabase start`, в облаке — настройки проекта Supabase.',
    );
  }
  // По хосту, а не только по NODE_ENV: из локальной консоли с DATABASE_URL
  // облачной базы NODE_ENV не выставлен, и прежняя проверка не срабатывала.
  const remote = process.env.NODE_ENV === 'production' || !isLocalDatabaseUrl(databaseUrl);
  if (remote && !process.argv.includes('--force')) {
    throw new Error(
      'db:reset: база не локальная. Это удаление всех данных — повторите с --force, если действительно этого хотите.',
    );
  }

  // Полная проверка окружения ДО первого delete. Без неё заданный
  // DATABASE_URL при отсутствующем SUPABASE_SERVICE_ROLE_KEY означал:
  // данные снесены, `runSeed()` падает на своей проверке, база пуста и
  // восстановить её нечем.
  assertSeedEnv();

  const db = createDbClient(databaseUrl);
  // Клиентское окружение не сбрасывается даже с --force: метку снимают руками.
  const [environmentKind] = await db.execute<{ value: unknown }>(
    sql`select value from settings where key = ${ENVIRONMENT_KIND_KEY}`,
  );
  assertDemoDataAllowed(environmentKind?.value, 'db:reset');
  const keepEmails = SEED_ACCOUNTS.map((a) => a.email);

  console.log('Сношу демо-данные…');
  // Одной транзакцией снос и пересев не обёрнуты сознательно: `runSeed()`
  // открывает своё соединение и вдобавок ходит в Admin API GoTrue за
  // аккаунтами — общий BEGIN/COMMIT покрыл бы только половину работы и
  // создавал бы ложное чувство атомарности. Защита здесь — preflight выше.
  for (const table of TABLES_IN_DELETE_ORDER) {
    await db.execute(sql.raw(`delete from ${table}`));
  }
  await db.execute(
    sql`delete from users where email not in (${sql.join(
      keepEmails.map((e) => sql`${e}`),
      sql`, `,
    )})`,
  );
  await db.execute(
    sql`delete from companies where id not in (select company_id from users where company_id is not null)`,
  );
  console.log(`Оставлены ${keepEmails.length} демо-аккаунтов и их компании.`);

  await runSeed();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('pnpm db:reset упал:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
