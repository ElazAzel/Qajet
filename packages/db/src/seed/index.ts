import { createClient } from '@supabase/supabase-js';
import { createDbClient } from '../client.js';
import * as schema from '../schema/index.js';
import { generateSeedDataset } from './generator.js';

/**
 * `pnpm db:seed` — agents.md §13. Один и тот же прогон работает и против
 * локального Supabase в Docker, и против облачного проекта: разница только
 * в значениях `DATABASE_URL`/`NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`
 * в `.env`, код не меняется.
 *
 * Порядок вставки следует внешним ключам схемы (packages/db/src/schema/*.ts):
 * компании → пользователи (после создания в auth.users) → профили/статистика
 * поставщиков → заявки → позиции → оценки → предоплаты → RFQ → КП → строки
 * КП → планы → строки плана → отбраковка → заказы → события стадий →
 * выплаты → документы → рейтинги → learning_events → price_observations →
 * model_snapshots.
 *
 * ЧЕСТНО: этот скрипт не был запущен против настоящей базы в сессии, где он
 * написан — там не было ни одного из трёх переменных окружения ниже. Он
 * прогнан только как чистая функция (`generator.test.ts`, без сети) и
 * типизирован через `tsc --noEmit`. Реальный прогон против Supabase остаётся
 * на пользователе — это первое, что стоит проверить перед тем как считать
 * фазу 3 полностью готовой.
 */

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const missing = [
    !databaseUrl && 'DATABASE_URL',
    !supabaseUrl && 'NEXT_PUBLIC_SUPABASE_URL',
    !serviceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY',
  ].filter((v): v is string => Boolean(v));
  if (missing.length > 0) {
    console.error(
      `pnpm db:seed: не заданы переменные окружения: ${missing.join(', ')}. См. .env.example — локально это \`supabase start\`, в облаке — настройки проекта Supabase.`,
    );
    process.exitCode = 1;
    return;
  }

  const referenceDateIso = new Date().toISOString().slice(0, 10);
  console.log(`Генерирую сид детерминированно (seed=1, дата отсчёта ${referenceDateIso})…`);
  const dataset = generateSeedDataset({ seed: 1, referenceDateIso });

  const auth = createClient(supabaseUrl as string, serviceRoleKey as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`Создаю ${dataset.accounts.length} аккаунтов в auth.users…`);
  for (const account of dataset.accounts) {
    // `id` — задокументированное расширение admin.createUser() именно для сидов
    // с заранее известным id (совпадающим с public.users.id, который уже
    // проставлен во всём сгенерированном графе как FK). Если конкретная версия
    // GoTrue его игнорирует — это вскроется здесь при первом реальном прогоне.
    const { error } = await auth.auth.admin.createUser({
      id: account.userId,
      email: account.email,
      password: account.password,
      email_confirm: true,
      user_metadata: { full_name: account.fullName },
    });
    if (error && !/already registered|already exists/i.test(error.message)) {
      throw new Error(`Не удалось создать аккаунт ${account.email}: ${error.message}`);
    }
  }

  const db = createDbClient(databaseUrl as string);

  console.log('Пишу строки в базу…');
  await insertBatched(db, schema.settings, dataset.settings);
  await insertBatched(db, schema.companies, dataset.companies);
  await insertBatched(db, schema.users, dataset.users);
  await insertBatched(db, schema.supplierProfiles, dataset.supplierProfiles);
  await insertBatched(db, schema.supplierStats, dataset.supplierStats);
  await insertBatched(db, schema.requests, dataset.requests);
  await insertBatched(db, schema.requestItems, dataset.requestItems);
  await insertBatched(db, schema.estimates, dataset.estimates);
  await insertBatched(db, schema.prepayments, dataset.prepayments);
  await insertBatched(db, schema.rfqs, dataset.rfqs);
  await insertBatched(db, schema.quotes, dataset.quotes);
  await insertBatched(db, schema.quoteLines, dataset.quoteLines);
  await insertBatched(db, schema.plans, dataset.plans);
  await insertBatched(db, schema.planLines, dataset.planLines);
  await insertBatched(db, schema.planRejections, dataset.planRejections);
  await insertBatched(db, schema.orders, dataset.orders);
  await insertBatched(db, schema.orderStageEvents, dataset.orderStageEvents);
  await insertBatched(db, schema.supplierPayouts, dataset.supplierPayouts);
  await insertBatched(db, schema.documents, dataset.documents);
  await insertBatched(db, schema.ratings, dataset.ratings);
  await insertBatched(db, schema.learningEvents, dataset.learningEvents);
  await insertBatched(db, schema.priceObservations, dataset.priceObservations);
  await insertBatched(db, schema.modelSnapshots, dataset.modelSnapshots);

  console.log('Готово:');
  console.log(`  ${dataset.companies.length} компаний, ${dataset.accounts.length} аккаунтов`);
  console.log(
    `  ${dataset.orders.length} заказов (${dataset.orders.filter((o) => o.state === 'closed').length} закрыто)`,
  );
  console.log(
    `  ${dataset.priceObservations.length} price_observations, ${dataset.modelSnapshots.length} model_snapshots`,
  );
  console.log('Быстрый вход (dev): buyer/supplier/concierge/admin@demo.qajet.kz, пароль qajet2026');
}

type Db = ReturnType<typeof createDbClient>;

const BATCH_SIZE = 500;

async function insertBatched<T extends Record<string, unknown>>(
  db: Db,
  table: Parameters<Db['insert']>[0],
  rows: readonly T[],
): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    // biome-ignore lint/suspicious/noExplicitAny: обобщённый батч-инсерт по разным схемам таблиц, конкретный тип строки проверен на стороне generator.ts через $inferInsert.
    await db.insert(table).values(chunk as any);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('pnpm db:seed упал:', err);
    process.exit(1);
  });
