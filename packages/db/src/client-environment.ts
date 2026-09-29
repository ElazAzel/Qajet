import type postgres from 'postgres';
import { CLIENT_ENVIRONMENT, ENVIRONMENT_KIND_KEY, type QajetRequisites } from './environment.js';
import { SEED_ACCOUNTS } from './seed/accounts.js';
import { DEMO_ORDER_REQUEST_TITLE } from './seed/generator.js';
import { OPERATIONAL_SETTINGS } from './seed/operational-settings.js';

type Sql = postgres.Sql | postgres.TransactionSql;

export async function readEnvironmentKind(sql: Sql): Promise<unknown> {
  const rows = await sql<{ value: unknown }[]>`
    select value from public.settings where key = ${ENVIRONMENT_KIND_KEY}`;
  return rows[0]?.value;
}

/**
 * Почему база не годится под клиентов. Пустой список — база чистая.
 * Проверяется то, что делает демо опасным рядом с данными клиента: аккаунты
 * с паролем из репозитория и демо-история с выдуманными поставщиками.
 */
export async function findDemoData(sql: Sql): Promise<string[]> {
  const reasons: string[] = [];
  const demoEmails = SEED_ACCOUNTS.map((account) => account.email);
  const [demoUsers] = await sql<{ count: number }[]>`
    select count(*)::int as count from public.users where email in ${sql(demoEmails)}`;
  if ((demoUsers?.count ?? 0) > 0)
    reasons.push(`демо-аккаунты с паролем из репозитория: ${demoUsers?.count}`);
  const [demoOrder] = await sql<{ count: number }[]>`
    select count(*)::int as count from public.requests where title = ${DEMO_ORDER_REQUEST_TITLE}`;
  if ((demoOrder?.count ?? 0) > 0) reasons.push('демо-заказ из сида');
  const [requests] = await sql<{ count: number }[]>`
    select count(*)::int as count from public.requests`;
  if ((requests?.count ?? 0) > 0) reasons.push(`в базе уже есть заявки: ${requests?.count}`);
  return reasons;
}

export interface ClientEnvironmentInput {
  requisites: QajetRequisites;
  /** auth.users уже создан вызывающим (Supabase Auth admin API) с этим id. */
  admin: { id: string; email: string; fullName: string };
}

/**
 * Пишет всё, без чего клиентское окружение не работает, одним вызовом внутри
 * транзакции вызывающего. Повторный вызов безопасен: настройки экономики не
 * перетираются (их правят вживую в /admin/settings), реквизиты и метка —
 * да, профиль админа не дублируется.
 */
export async function writeClientEnvironment(
  tx: postgres.TransactionSql,
  input: ClientEnvironmentInput,
): Promise<void> {
  for (const { key, value } of OPERATIONAL_SETTINGS) {
    await tx`insert into public.settings (key, value) values (${key}, ${tx.json(value as postgres.JSONValue)})
      on conflict (key) do nothing`;
  }
  const requisites = input.requisites as unknown as postgres.JSONValue;
  await tx`insert into public.settings (key, value) values ('qajet_requisites', ${tx.json(requisites)})
    on conflict (key) do update set value = excluded.value, updated_at = now()`;
  await tx`insert into public.settings (key, value) values (${ENVIRONMENT_KIND_KEY}, ${tx.json(CLIENT_ENVIRONMENT)})
    on conflict (key) do update set value = excluded.value, updated_at = now()`;
  await tx`insert into public.users (id, company_id, email, full_name, role, is_active)
    values (${input.admin.id}, null, ${input.admin.email}, ${input.admin.fullName}, 'admin', true)
    on conflict (id) do nothing`;
}
