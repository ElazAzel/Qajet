import { createClient } from '@supabase/supabase-js';
import { and, eq, inArray } from 'drizzle-orm';
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
  // Одна транзакция на всю запись: раньше сбой посередине оставлял базу
  // заполненной наполовину, и повторный запуск упирался в уже вставленное.
  await db.transaction(async (tx) => {
    await insertBatched(tx, schema.settings, dataset.settings);
    await insertBatched(tx, schema.companies, dataset.companies);
    await insertBatched(tx, schema.users, dataset.users);
    await insertBatched(tx, schema.supplierProfiles, dataset.supplierProfiles);
    await insertBatched(tx, schema.supplierStats, dataset.supplierStats);
    await insertBatched(tx, schema.requests, dataset.requests);
    await insertBatched(tx, schema.requestItems, dataset.requestItems);
    await insertBatched(tx, schema.estimates, dataset.estimates);
    await insertBatched(tx, schema.prepayments, dataset.prepayments);
    await insertBatched(tx, schema.rfqs, dataset.rfqs);
    await insertBatched(tx, schema.quotes, dataset.quotes);
    await insertBatched(tx, schema.quoteLines, dataset.quoteLines);
    await insertBatched(tx, schema.plans, dataset.plans);
    await insertBatched(tx, schema.planLines, dataset.planLines);
    await insertBatched(tx, schema.planRejections, dataset.planRejections);
    await insertBatched(tx, schema.orders, dataset.orders);
    await insertBatched(tx, schema.orderStageEvents, dataset.orderStageEvents);
    await insertBatched(tx, schema.paymentFacts, dataset.paymentFacts);
    await insertBatched(tx, schema.supplierPayouts, dataset.supplierPayouts);
    await insertBatched(tx, schema.documents, dataset.documents);
    await insertBatched(tx, schema.ratings, dataset.ratings);
    await insertBatched(tx, schema.learningEvents, dataset.learningEvents);
    await insertBatched(tx, schema.priceObservations, dataset.priceObservations);
    await insertBatched(tx, schema.modelSnapshots, dataset.modelSnapshots);
    await insertBatched(tx, schema.timeEntries, dataset.timeEntries);
    await insertThreadsAndMessages(tx, dataset.threads, dataset.messages);
    await insertBatched(tx, schema.permissions, dataset.permissions);
    await insertBatched(tx, schema.changeRequests, dataset.changeRequests);
  });

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
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type ThreadRow = typeof schema.threads.$inferInsert;
type MessageRow = typeof schema.messages.$inferInsert;

const BATCH_SIZE = 500;

async function insertBatched<T extends Record<string, unknown>>(
  db: Tx,
  table: Parameters<Tx['insert']>[0],
  rows: readonly T[],
): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    // biome-ignore lint/suspicious/noExplicitAny: обобщённый батч-инсерт по разным схемам таблиц, конкретный тип строки проверен на стороне generator.ts через $inferInsert.
    await db.insert(table).values(chunk as any);
  }
}

/**
 * Треды заказа создают триггеры `orders_ensure_threads` и соседние в момент
 * вставки заказа. Сид был написан раньше этих триггеров, вставлял свои треды
 * поверх и падал на уникальных индексах `threads_order_{buyer,internal}_unique`,
 * так что `pnpm db:reset` не работал на чистой базе. Теперь сид берёт тред,
 * который уже создал триггер, возвращает ему исторические даты и переносит
 * на него свои сообщения; вставляются только недостающие треды.
 */
async function insertThreadsAndMessages(
  tx: Tx,
  threads: readonly ThreadRow[],
  messages: readonly MessageRow[],
): Promise<void> {
  const orderIds = [...new Set(threads.flatMap((t) => (t.orderId ? [t.orderId] : [])))];
  const existing =
    orderIds.length === 0
      ? []
      : await tx
          .select({
            id: schema.threads.id,
            orderId: schema.threads.orderId,
            kind: schema.threads.kind,
          })
          .from(schema.threads)
          .where(
            and(
              inArray(schema.threads.orderId, orderIds),
              inArray(schema.threads.kind, ['buyer', 'internal']),
            ),
          );
  const existingByKey = new Map(existing.map((t) => [`${t.orderId}:${t.kind}`, t.id]));

  const threadIdMap = new Map<string, string>();
  const missing: ThreadRow[] = [];
  for (const thread of threads) {
    const existingId = thread.orderId
      ? existingByKey.get(`${thread.orderId}:${thread.kind}`)
      : undefined;
    if (!existingId || !thread.id) {
      missing.push(thread);
      continue;
    }
    threadIdMap.set(thread.id, existingId);
    await tx
      .update(schema.threads)
      .set({
        ...(thread.createdAt ? { createdAt: thread.createdAt } : {}),
        ...(thread.updatedAt ? { updatedAt: thread.updatedAt } : {}),
      })
      .where(eq(schema.threads.id, existingId));
  }

  await insertBatched(tx, schema.threads, missing);
  await insertBatched(
    tx,
    schema.messages,
    messages.map((m) => ({ ...m, threadId: threadIdMap.get(m.threadId) ?? m.threadId })),
  );
}
