import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import {
  findDemoData,
  readEnvironmentKind,
  writeClientEnvironment,
} from '../client-environment.js';
import { CLIENT_ENVIRONMENT, validateRequisites } from '../environment.js';
import { DEMO_PASSWORD } from '../seed/accounts.js';

/**
 * `pnpm --filter @qajet/db db:provision-clients --requisites=./requisites.json`
 *
 * Готовит ЧИСТУЮ базу под платных клиентов: параметры экономики, настоящие
 * реквизиты QAJET (они попадают в каждый счёт и акт), метку клиентского
 * окружения и первого админа. Демо-сид и `db:reset` после этого отказываются
 * работать с базой. Миграции (`db:migrate`) запускаются заранее.
 *
 * Пароль админа задаёт владелец в CLIENT_ADMIN_PASSWORD — скрипт его не
 * генерирует и не печатает: в отличие от демо, он не должен оказаться ни в
 * репозитории, ни в логе.
 */

function fail(message: string): never {
  console.error(`db:provision-clients: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const env = (name: string) => process.env[name]?.trim() || fail(`не задан ${name}`);
  const databaseUrl = env('DATABASE_URL');
  const supabaseUrl = env('NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY');
  const adminEmail = env('CLIENT_ADMIN_EMAIL').toLowerCase();
  const adminName = env('CLIENT_ADMIN_NAME');
  const adminPassword = env('CLIENT_ADMIN_PASSWORD');
  if (adminPassword.length < 12 || adminPassword === DEMO_PASSWORD) {
    fail('CLIENT_ADMIN_PASSWORD — не короче 12 символов и не демо-пароль');
  }

  const requisitesPath = process.argv.find((arg) => arg.startsWith('--requisites='))?.slice(13);
  if (!requisitesPath) fail('укажите --requisites=<путь к JSON с реквизитами QAJET>');
  let rawRequisites: unknown;
  try {
    rawRequisites = JSON.parse(readFileSync(requisitesPath, 'utf8'));
  } catch {
    fail(`не удалось прочитать JSON реквизитов: ${requisitesPath}`);
  }
  const requisites = validateRequisites(rawRequisites);
  if (!requisites.ok) fail(`реквизиты не прошли проверку:\n- ${requisites.errors.join('\n- ')}`);

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const [settingsTable] = await sql<{ exists: boolean }[]>`
      select to_regclass('public.settings') is not null as exists`;
    if (!settingsTable?.exists) fail('схемы нет — сначала `pnpm --filter @qajet/db db:migrate`');

    const alreadyClients = (await readEnvironmentKind(sql)) === CLIENT_ENVIRONMENT;
    if (!alreadyClients) {
      const reasons = await findDemoData(sql);
      if (reasons.length > 0) {
        fail(
          `база не чистая, клиентов сюда заводить нельзя:\n- ${reasons.join('\n- ')}\n` +
            'Нужен отдельный проект Supabase только под клиентов.',
        );
      }
    }

    const auth = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const created = await auth.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: { full_name: adminName },
    });
    let adminId = created.data.user?.id;
    if (!adminId) {
      if (!/already (been )?registered|already exists/i.test(created.error?.message ?? '')) {
        fail('Supabase Auth не создал пользователя админа');
      }
      const [existing] = await sql<{ id: string }[]>`
        select id from auth.users where lower(email) = ${adminEmail}`;
      adminId = existing?.id ?? fail('админ уже зарегистрирован, но не найден в auth.users');
      console.log('Админ уже был в Supabase Auth — пароль не менялся.');
    }

    await sql.begin((tx) =>
      writeClientEnvironment(tx, {
        requisites: requisites.value,
        admin: { id: adminId, email: adminEmail, fullName: adminName },
      }),
    );
    console.log(
      `Готово: клиентское окружение размечено, реквизиты «${requisites.value.legalName}» записаны, ` +
        `админ ${adminEmail} может войти. Демо-сид и db:reset для этой базы заблокированы.`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
