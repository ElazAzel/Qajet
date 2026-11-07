/**
 * Логическая резервная копия базы — бесплатная замена автоматическим копиям
 * Supabase (они есть только на платных тарифах).
 *
 *   node tools/ops/backup-database.mjs                  # DATABASE_URL
 *   node tools/ops/backup-database.mjs --url=postgres://…
 *   node tools/ops/backup-database.mjs --verify         # плюс пробное восстановление
 *   node tools/ops/backup-database.mjs --keep=14        # чистка копий старше N дней
 *
 * Что снимается. Две части, как выяснила репетиция (docs/runbooks/backup-restore.md):
 *   1. `public` + `drizzle` — бизнес-данные и журнал миграций;
 *   2. `auth` + `storage` — пользователи и метаданные файлов, от роли
 *      supabase_admin: от обычной `postgres` дамп упирается в права на схемы.
 * Файлы Storage в дамп НЕ входят — это метаданные, а не содержимое.
 *
 * `--verify` поднимает пустой контейнер того же образа, восстанавливает туда
 * копию и проверяет, что она читается. Невосстановленная копия не проверена:
 * репетиция нашла два места, где простое восстановление даёт нерабочую систему.
 *
 * Копия содержит персональные данные (agents.md, ADR-0011): храните её там же,
 * где разрешено хранить сами данные. Каталог backups/ не коммитится.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const argv = process.argv.slice(2);
const flag = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

const url = flag('url') ?? process.env.DATABASE_URL;
const verify = argv.includes('--verify');
const keepDays = Number(flag('keep') ?? 0);

if (!url) {
  console.error(
    'backup-database: не задана база. Укажите --url=… или DATABASE_URL.\n' +
      'Локально это `supabase start`, для облака — строка подключения из настроек проекта.',
  );
  process.exit(1);
}

let host;
try {
  host = new URL(url).hostname;
} catch {
  console.error('backup-database: DATABASE_URL не разобрался как строка подключения.');
  process.exit(1);
}
const isLocal = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);

/**
 * pg_dump запускается ВНУТРИ контейнера базы, поэтому локальный адрес надо
 * переписать: 54322 — это порт, проброшенный на хост, а внутри контейнера
 * postgres слушает обычный 5432. Для внешних адресов переписывать нечего,
 * контейнер ходит наружу сам.
 */
function inContainerUrl(target) {
  if (!isLocal) return target;
  const parsed = new URL(target);
  parsed.hostname = '127.0.0.1';
  parsed.port = '5432';
  return parsed.toString();
}
const execUrl = inContainerUrl(url);

/** Клиент pg_dump берём из запущенного контейнера Supabase: его версия совпадает с сервером. */
function dbContainer() {
  const ps = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
  if (ps.status !== 0) return null;
  return (
    ps.stdout
      .split(/\r?\n/)
      .find((n) => /^supabase_db_/.test(n.trim()))
      ?.trim() ?? null
  );
}

const container = dbContainer();
if (!container) {
  console.error(
    'backup-database: не найден контейнер supabase_db_*. Нужен запущенный Docker: из него берётся pg_dump той же версии, что и сервер.',
  );
  process.exit(1);
}

const imageOf = spawnSync('docker', ['inspect', container, '--format', '{{.Config.Image}}'], {
  encoding: 'utf8',
});
const image = imageOf.stdout.trim();

const dir = resolve(root, 'backups');
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const base = `${stamp}_${host.replace(/[^a-zA-Z0-9]/g, '-')}`;

/**
 * Дамп идёт внутри контейнера и пишется в stdout, который мы сохраняем файлом.
 * Так не нужен pg_dump на хосте и не нужен том, примонтированный в контейнер.
 */
function dump(label, args, file) {
  const out = spawnSync(
    'docker',
    ['exec', '-i', container, 'pg_dump', ...args, '--dbname', execUrl],
    { encoding: 'buffer', maxBuffer: 1024 * 1024 * 1024 },
  );
  if (out.status !== 0) {
    console.error(`backup-database: pg_dump (${label}) завершился с ошибкой.`);
    process.stderr.write(out.stderr?.toString() ?? '');
    return null;
  }
  const path = resolve(dir, file);
  writeFileSync(path, out.stdout);
  const bytes = statSync(path).size;
  const sha = createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
  console.log(`  ${label}: ${file} — ${(bytes / 1048576).toFixed(1)} МБ, sha256:${sha}`);
  return { path, bytes };
}

console.log(
  `backup-database: ${host}${isLocal ? ' (локальная)' : ' (НЕ локальная — копия с реальными данными)'}`,
);
if (!isLocal) {
  console.log(
    '  Копия содержит персональные данные. Храните её по тем же правилам, что и сами данные (ADR-0011).',
  );
}
console.log(`  образ: ${image}`);

const business = dump(
  'данные и миграции',
  ['-Fc', '-n', 'public', '-n', 'drizzle'],
  `${base}_public.dump`,
);
const identity = dump(
  'auth и storage',
  ['-Fc', '-n', 'auth', '-n', 'storage', '-U', 'supabase_admin'],
  `${base}_auth.dump`,
);

if (!business || !identity) {
  console.error('backup-database: копия неполная — не считайте её резервной.');
  process.exit(1);
}

// Определение auth.uid() зависит от версии GoTrue: без него восстановленная
// база закрывает доступ всем (находка 1 репетиции). Сохраняем рядом.
const uid = spawnSync(
  'docker',
  [
    'exec',
    '-i',
    container,
    'psql',
    '-At',
    '-c',
    "select pg_get_functiondef('auth.uid()'::regprocedure)",
    '--dbname',
    execUrl,
  ],
  { encoding: 'utf8' },
);
if (uid.status === 0 && uid.stdout.trim()) {
  writeFileSync(resolve(dir, `${base}_auth_uid.sql`), uid.stdout);
  const modern = uid.stdout.includes('request.jwt.claims');
  console.log(
    `  auth.uid(): сохранено, ${modern ? 'нужной версии' : 'СТАРОЙ версии — проверьте GoTrue'}`,
  );
}

if (keepDays > 0) {
  const cutoff = Date.now() - keepDays * 86400000;
  let removed = 0;
  for (const name of readdirSync(dir)) {
    const path = resolve(dir, name);
    if (statSync(path).mtimeMs < cutoff) {
      unlinkSync(path);
      removed++;
    }
  }
  if (removed > 0) console.log(`  удалено старых файлов: ${removed} (старше ${keepDays} дн.)`);
}

if (!verify) {
  console.log(
    '\nКопия снята, но НЕ проверена восстановлением. Проверить: --verify (или см. docs/runbooks/backup-restore.md).',
  );
  process.exit(0);
}

console.log('\nПробное восстановление в одноразовый контейнер…');
const probe = `qajet_backup_verify_${Date.now()}`;
const run = spawnSync(
  'docker',
  ['run', '-d', '--name', probe, '-e', 'POSTGRES_PASSWORD=postgres', image],
  { encoding: 'utf8' },
);
if (run.status !== 0) {
  console.error('backup-database: не удалось поднять контейнер для проверки.');
  process.stderr.write(run.stderr ?? '');
  process.exit(1);
}

// Любая ошибка процесса делает результат непроверенным, даже если stdout
// выглядит правдоподобно. Не печатаем сырой stderr: там могут быть данные БД.
function requireSuccess(result, label) {
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(`${label}: команда не завершилась успешно`);
  }
}

function readCounts(result, label) {
  requireSuccess(result, label);
  const value = result.stdout?.trim() ?? '';
  if (!/^(0|[1-9]\d*)\/(0|[1-9]\d*)\/(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${label}: ожидались три неотрицательных целых счётчика`);
  }
  return value;
}

try {
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    ready =
      spawnSync('docker', ['exec', probe, 'pg_isready', '-U', 'postgres', '-h', '127.0.0.1'])
        .status === 0;
    if (!ready) spawnSync('docker', ['exec', probe, 'sleep', '1']);
  }
  if (!ready) throw new Error('контейнер не стал принимать подключения');

  const restore = (file, role) =>
    spawnSync(
      'docker',
      [
        'exec',
        '-i',
        probe,
        'pg_restore',
        '-U',
        role,
        '-d',
        'postgres',
        '--no-owner',
        '--clean',
        '--if-exists',
        '--exit-on-error',
      ],
      { input: readFileSync(file), encoding: 'buffer', maxBuffer: 1024 * 1024 * 1024 },
    );

  requireSuccess(restore(identity.path, 'supabase_admin'), 'pg_restore auth/storage');
  requireSuccess(restore(business.path, 'postgres'), 'pg_restore public/drizzle');

  const count = spawnSync(
    'docker',
    [
      'exec',
      probe,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-At',
      '-c',
      "select (select count(*) from public.orders) || '/' || (select count(*) from auth.users) || '/' || (select count(*) from public.companies)",
    ],
    { encoding: 'utf8' },
  );
  const got = readCounts(count, 'psql копии');
  const source = spawnSync(
    'docker',
    [
      'exec',
      container,
      'psql',
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-At',
      '-c',
      "select (select count(*) from public.orders) || '/' || (select count(*) from auth.users) || '/' || (select count(*) from public.companies)",
      '--dbname',
      execUrl,
    ],
    { encoding: 'utf8' },
  );

  const want = readCounts(source, 'psql источника');
  console.log(`  заказы/пользователи/компании — источник ${want}, копия ${got}`);
  if (got === want) {
    console.log(
      '  ПРОВЕРЕНО: оба pg_restore завершились без ошибок; три счётчика строк совпадают.',
    );
  } else {
    console.error(
      '  РАСХОЖДЕНИЕ: счётчики источника и копии различаются; копия НЕ проверена. Источник мог измениться после дампа.',
    );
    process.exitCode = 1;
  }
  console.log(
    '  Это проверка читаемости, а не полного восстановления: RLS, права и файлы Storage проверяются по docs/runbooks/backup-restore.md.',
  );
} catch (error) {
  console.error(`backup-database: проверка не удалась — ${error.message}`);
  process.exitCode = 1;
} finally {
  spawnSync('docker', ['rm', '-f', probe], { stdio: 'ignore' });
}
