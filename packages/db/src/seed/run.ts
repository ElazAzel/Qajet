import { createClient } from '@supabase/supabase-js';
import { eq, inArray } from 'drizzle-orm';
import { createDbClient } from '../client.js';
import * as schema from '../schema/index.js';
import { SEED_ACCOUNTS } from './accounts.js';
import { DEMO_ORDER_REQUEST_TITLE, generateSeedDataset } from './generator.js';

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
 * payment_facts → выплаты → документы → рейтинги → learning_events → price_observations →
 * model_snapshots → учёт времени → треды/сообщения → доступы → запросы на
 * изменение плана.
 *
 * Только ВСТАВКА. Повторный прогон без сброса запрещён явной проверкой
 * демо-заявки: это не позволяет случайно удвоить историю или смешать её с
 * рабочими данными. Для повторного заполнения есть `pnpm db:reset`
 * (`packages/db/src/scripts/reset.ts`), который сносит демо-данные и зовёт
 * этот же `runSeed()`.
 */

/**
 * Проверка окружения отдельно от самого сида — чтобы `db:reset` мог позвать
 * её ДО первого `delete`. Иначе при заданном DATABASE_URL, но отсутствующем
 * SUPABASE_SERVICE_ROLE_KEY сброс успевал снести данные и падал уже на
 * сиде, оставляя базу пустой: ошибка конфигурации превращалась в потерю
 * данных.
 */
export function assertSeedEnv(): void {
  const missing = [
    !process.env.DATABASE_URL && 'DATABASE_URL',
    !process.env.NEXT_PUBLIC_SUPABASE_URL && 'NEXT_PUBLIC_SUPABASE_URL',
    !process.env.SUPABASE_SERVICE_ROLE_KEY && 'SUPABASE_SERVICE_ROLE_KEY',
  ].filter((v): v is string => Boolean(v));
  if (missing.length > 0) {
    throw new Error(
      `не заданы переменные окружения: ${missing.join(', ')}. См. .env.example — локально это \`supabase start\`, в облаке — настройки проекта Supabase.`,
    );
  }
}

export async function runSeed(): Promise<void> {
  assertSeedEnv();
  const databaseUrl = process.env.DATABASE_URL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const db = createDbClient(databaseUrl as string);

  const [existingDemoRequest] = await db
    .select({ id: schema.requests.id })
    .from(schema.requests)
    .where(eq(schema.requests.title, DEMO_ORDER_REQUEST_TITLE))
    .limit(1);
  if (existingDemoRequest) {
    throw new Error(
      'Демо-история уже существует. Для повторного заполнения используйте `pnpm db:reset`, а не `pnpm db:seed`.',
    );
  }

  // Повторный прогон против непустой базы (например, демо-аккаунты уже были
  // заведены вручную до появления этого генератора) — переиспользуем то, что
  // уже есть, вместо того чтобы дублировать компанию-покупателя и аккаунты
  // со свежими id. На пустой базе все поиски просто возвращают ничего.
  const emails = SEED_ACCOUNTS.map((a) => a.email);
  const existingUsers = await db
    .select({ id: schema.users.id, email: schema.users.email, companyId: schema.users.companyId })
    .from(schema.users)
    .where(inArray(schema.users.email, emails));
  const accountsByEmail = Object.fromEntries(existingUsers.map((u) => [u.email, u.id]));
  const buyerUser = existingUsers.find((u) => u.email === 'buyer@demo.qajet.kz');
  const supplierUser = existingUsers.find((u) => u.email === 'supplier@demo.qajet.kz');

  const referenceDateIso = new Date().toISOString().slice(0, 10);
  console.log(`Генерирую сид детерминированно (seed=1, дата отсчёта ${referenceDateIso})…`);
  const dataset = generateSeedDataset({
    seed: 1,
    referenceDateIso,
    existing: {
      ...(buyerUser?.companyId ? { buyerCompanyId: buyerUser.companyId } : {}),
      ...(supplierUser?.companyId ? { supplierCompanyId: supplierUser.companyId } : {}),
      accountsByEmail,
    },
  });

  const auth = createClient(supabaseUrl as string, serviceRoleKey as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const newAccounts = dataset.accounts.filter((a) => a.isNew);
  console.log(
    `Создаю ${newAccounts.length} новых аккаунтов в auth.users (${dataset.accounts.length - newAccounts.length} уже существовали)…`,
  );
  for (const account of newAccounts) {
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
  await insertBatched(db, schema.paymentFacts, dataset.paymentFacts);
  await insertBatched(db, schema.supplierPayouts, dataset.supplierPayouts);
  await insertBatched(db, schema.documents, dataset.documents);
  await insertBatched(db, schema.ratings, dataset.ratings);
  await insertBatched(db, schema.learningEvents, dataset.learningEvents);
  await insertBatched(db, schema.priceObservations, dataset.priceObservations);
  await insertBatched(db, schema.modelSnapshots, dataset.modelSnapshots);
  await insertBatched(db, schema.timeEntries, dataset.timeEntries);
  await insertBatched(db, schema.threads, dataset.threads);
  await insertBatched(db, schema.messages, dataset.messages);
  await insertBatched(db, schema.permissions, dataset.permissions);
  await insertBatched(db, schema.changeRequests, dataset.changeRequests);

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
