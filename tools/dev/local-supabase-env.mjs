/**
 * Окружение для работы с локальной Supabase (`supabase start`) без ручной
 * копипасты ключей. Один и тот же скрипт нужен разработчику и CI:
 *
 *   node tools/dev/local-supabase-env.mjs                 # пишет .env.local (корень и apps/web)
 *   node tools/dev/local-supabase-env.mjs --github-env    # добавляет переменные в $GITHUB_ENV
 *
 * Значения берутся из `supabase status -o env`. Секреты подписи ссылок и cron —
 * константы для локальной работы, не секреты: в общем окружении они другие.
 * Скрипт отказывается работать, если Supabase указывает не на localhost.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const toGithubEnv = process.argv.includes('--github-env');
const bin = process.env.SUPABASE_BIN ?? 'supabase';

const status = spawnSync(bin, ['status', '-o', 'env'], {
  cwd: root,
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
if (status.status !== 0) {
  console.error(
    'local-supabase-env: `supabase status` не вернул параметры. Запустите `supabase start`.',
  );
  console.error(status.stderr?.trim() ?? '');
  process.exit(1);
}

const raw = {};
for (const line of status.stdout.split(/\r?\n/)) {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (match) raw[match[1]] = match[2].trim().replace(/^"(.*)"$/, '$1');
}

const values = {
  NEXT_PUBLIC_SUPABASE_URL: raw.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: raw.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: raw.SERVICE_ROLE_KEY,
  DATABASE_URL: raw.DB_URL,
  NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3000',
  LINK_SIGNING_SECRET: 'local-dev-only-link-signing-secret-000000000000',
  CRON_SECRET: 'local-dev-only-cron-secret-0000000000000000',
};

const missing = Object.entries(values)
  .filter(([, value]) => !value)
  .map(([key]) => key);
if (missing.length > 0) {
  console.error(`local-supabase-env: в выводе supabase status нет: ${missing.join(', ')}`);
  process.exit(1);
}

const host = new URL(values.NEXT_PUBLIC_SUPABASE_URL).hostname;
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
  console.error(`local-supabase-env: Supabase указывает на ${host}, а не на локальную базу.`);
  process.exit(1);
}

if (toGithubEnv) {
  const target = process.env.GITHUB_ENV;
  if (!target) {
    console.error('local-supabase-env: --github-env вне GitHub Actions ($GITHUB_ENV не задан).');
    process.exit(1);
  }
  for (const [key, value] of Object.entries(values)) {
    if (key.includes('KEY') || key.includes('SECRET') || key === 'DATABASE_URL') {
      console.log(`::add-mask::${value}`);
    }
    appendFileSync(target, `${key}=${value}\n`);
  }
  console.log(
    `local-supabase-env: ${Object.keys(values).length} переменных добавлено в GITHUB_ENV.`,
  );
} else {
  const body = `# Сгенерировано tools/dev/local-supabase-env.mjs из \`supabase status\`. Не коммитить.\n${Object.entries(
    values,
  )
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`;
  for (const file of ['.env.local', 'apps/web/.env.local']) {
    writeFileSync(resolve(root, file), body, 'utf8');
  }
  console.log(`local-supabase-env: записано .env.local и apps/web/.env.local (${host}).`);
}
