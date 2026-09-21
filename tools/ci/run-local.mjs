/**
 * Локальный прогон тех же ворот, что и .github/workflows/ci.yml.
 *
 * Зачем. Когда GitHub Actions недоступен (исчерпаны минуты, заблокирован
 * биллинг), проверки всё равно надо выполнять — иначе ветка едет вслепую.
 * Этот скрипт запускает те же команды теми же аргументами и выдаёт ту же
 * трёхзначную сводку PASS / FAIL / NOT RUN.
 *
 * Чем это НЕ является. Результат здесь — `passed-local`, а не `PASS` в CI.
 * agents.md («Release semantics»): локальный прогон никогда не доказывает
 * поведение CI, провайдера, деплоя или production. Ворота CI остаются
 * NOT RUN, пока прогон в CI не выполнен. Поэтому итог пишется в
 * gates.local.json, а не в gates.json, который создаёт CI.
 *
 *   pnpm ci:local                  # всё, кроме пересева базы
 *   pnpm ci:local --fresh          # плюс db:migrate и db:reset, как в CI
 *   pnpm ci:local --only=lint,test # подмножество задач
 *   pnpm ci:local --skip=e2e       # исключить задачу
 *   pnpm ci:local --list           # показать имена задач и выйти
 *
 * Задачам с базой нужен запущенный локальный Supabase (`supabase start`).
 * Переменные берутся из `supabase status` в память — .env.local не трогается.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const argv = process.argv.slice(2);
const flag = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const has = (name) => argv.includes(`--${name}`);

const fresh = has('fresh');
const only = flag('only')?.split(',').filter(Boolean);
const skip = flag('skip')?.split(',').filter(Boolean) ?? [];

/**
 * Порядок повторяет ci.yml. `needsDb` — нужны ли переменные локальной Supabase.
 * Каждая команда запускается из корня, как и в CI.
 */
const JOBS = [
  {
    name: 'lint-and-typecheck',
    title: 'Lint + typecheck',
    steps: [
      ['pnpm', ['lint']],
      ['pnpm', ['typecheck']],
    ],
  },
  { name: 'test', title: 'Unit tests', steps: [['pnpm', ['test']]] },
  {
    name: 'build',
    title: 'Build apps/web',
    steps: [['pnpm', ['--filter', '@qajet/web', 'build']]],
  },
  {
    name: 'rls-isolation',
    title: 'Тесты с реальным PostgreSQL (RLS, права, целостность)',
    needsDb: true,
    steps: [
      ['pnpm', ['--filter', '@qajet/db', 'db:migrate']],
      ['pnpm', ['--filter', '@qajet/db', 'test:rls']],
      ['pnpm', ['--filter', '@qajet/pd', 'test:rls']],
    ],
  },
  {
    name: 'public-e2e',
    title: 'Публичные сценарии (Playwright, без базы)',
    steps: [
      ['pnpm', ['--filter', '@qajet/web', 'build']],
      [
        'pnpm',
        ['exec', 'playwright', 'test', 'e2e/public-smoke.spec.ts', 'e2e/startupbattle.spec.ts'],
        { cwd: resolve(root, 'apps/web') },
      ],
    ],
  },
  {
    name: 'e2e',
    title: 'Сквозные сценарии (Playwright, локальная Supabase)',
    needsDb: true,
    steps: [
      // Пересев данных разрушает локальную базу разработчика, поэтому он не
      // делается по умолчанию: в CI база каждый раз новая, здесь — нет.
      ...(fresh
        ? [
            ['pnpm', ['--filter', '@qajet/db', 'db:migrate']],
            ['pnpm', ['--filter', '@qajet/db', 'db:reset']],
          ]
        : []),
      ['pnpm', ['--filter', '@qajet/web', 'build']],
      ['pnpm', ['exec', 'playwright', 'test'], { cwd: resolve(root, 'apps/web') }],
    ],
  },
  {
    name: 'rag-freshness',
    title: 'RAG-индекс не отстал от кода',
    steps: [
      ['pnpm', ['rag:sync']],
      // Как в CI: сгенерированное не должно расходиться с рабочим деревом.
      ['git', ['diff', '--quiet', '--', 'docs/state']],
    ],
  },
];

if (has('list')) {
  for (const job of JOBS) console.log(`${job.name.padEnd(20)} ${job.title}`);
  process.exit(0);
}

const selected = JOBS.filter(
  (job) => (!only || only.includes(job.name)) && !skip.includes(job.name),
);
if (selected.length === 0) {
  console.error('ci:local: под --only/--skip не осталось ни одной задачи. См. --list.');
  process.exit(1);
}

/** Переменные локальной Supabase — в память, без записи .env.local. */
function localSupabaseEnv() {
  const result = spawnSync(
    process.execPath,
    [resolve(root, 'tools/dev/local-supabase-env.mjs'), '--print'],
    { cwd: root, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? '');
    return null;
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

const needsDb = selected.some((job) => job.needsDb);
let dbEnv = null;
if (needsDb) {
  dbEnv = localSupabaseEnv();
  if (!dbEnv) {
    console.error(
      'ci:local: нет локальной Supabase. Запустите `supabase start`, либо исключите задачи с базой: --skip=e2e,rls-isolation',
    );
    process.exit(1);
  }
}

const results = {};
const started = Date.now();

for (const job of selected) {
  const env = { ...process.env, ...(job.needsDb ? dbEnv : {}), CI: '1' };
  console.log(`\n── ${job.title} (${job.name})`);
  let outcome = 'PASS';
  for (const [command, args, options = {}] of job.steps) {
    // На Windows pnpm — это .cmd, который Node запускает только через shell.
    // Командная строка собирается целиком, а не передаётся аргументами при
    // shell: true: иначе Node предупреждает (DEP0190), что аргументы не
    // экранируются. Экранировать здесь нечего — весь JOBS состоит из констант
    // этого файла, внешний ввод в команду не попадает.
    const step =
      process.platform === 'win32'
        ? spawnSync([command, ...args].join(' '), [], {
            cwd: options.cwd ?? root,
            env,
            stdio: 'inherit',
            shell: true,
          })
        : spawnSync(command, args, { cwd: options.cwd ?? root, env, stdio: 'inherit' });
    if (step.status !== 0) {
      outcome = 'FAIL';
      console.error(`ci:local: ${job.name} — упал шаг: ${command} ${args.join(' ')}`);
      break;
    }
  }
  results[job.name] = outcome;
}

// NOT RUN — именно то, что не запускали: пропуск не доказательство.
for (const job of JOBS) results[job.name] ??= 'NOT RUN';

const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
const commit = head.status === 0 ? head.stdout.trim() : 'unknown';
const dirty =
  spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout.trim() !== '';

writeFileSync(
  resolve(root, 'gates.local.json'),
  `${JSON.stringify(
    {
      source: 'local',
      note: 'Локальный прогон. Не является доказательством CI, деплоя или production.',
      commit,
      workingTreeDirty: dirty,
      seeded: fresh,
      ranAt: new Date().toISOString(),
      durationSeconds: Math.round((Date.now() - started) / 1000),
      gates: results,
    },
    null,
    2,
  )}\n`,
);

const rows = Object.entries(results).map(([name, outcome]) => `| ${name} | ${outcome} |`);
console.log(`\n| Gate (local) | Result |\n| --- | --- |\n${rows.join('\n')}`);
console.log(
  `\nКоммит ${commit.slice(0, 7)}${dirty ? ' + незакоммиченные изменения' : ''}, ${Math.round(
    (Date.now() - started) / 1000,
  )}с. Записано gates.local.json.`,
);
console.log(
  'Это локальный прогон: в терминах agents.md — passed-local, а не PASS. Ворота CI, провайдера, деплоя и production остаются NOT RUN.',
);

if (Object.values(results).includes('FAIL')) process.exit(1);
