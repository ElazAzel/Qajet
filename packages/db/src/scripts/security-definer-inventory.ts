import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

/**
 * Опись SECURITY DEFINER-функций схемы public — по каталогу БД, а не по памяти.
 *
 *   DATABASE_URL=<локальная или тестовая БД> pnpm --filter @qajet/db db:inventory
 *
 * Пишет docs/security/security-definer-inventory.md. Только чтение: скрипт
 * выполняет SELECT по pg_catalog и ничего не меняет. Отказывается работать не
 * с локальной базой, чтобы опись не строилась случайно по production.
 *
 * Что здесь измеряется, а что нет. Измеряется: кто может выполнить, закреплён ли
 * search_path, встречаются ли в теле признаки проверки актёра, какие тесты
 * упоминают функцию по имени. НЕ измеряется: достаточна ли проверка внутри тела
 * и почему нужен именно SECURITY DEFINER. Признак в теле — не доказательство
 * корректности; это указатель, куда смотреть, и отсутствие признака у функции,
 * доступной authenticated, — повод для ручного разбора.
 */

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL не задан.');
  process.exit(1);
}
const host = new URL(databaseUrl).hostname;
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
  console.error(`Опись строится только по локальной базе, а не по ${host}.`);
  process.exit(1);
}

interface Row {
  name: string;
  args: string;
  returns: string;
  is_trigger: boolean;
  anon: boolean;
  authenticated: boolean;
  service_role: boolean;
  search_path: string | null;
  body: string;
}

const sql = postgres(databaseUrl, { max: 1, prepare: false });
const rows = await sql<Row[]>`
  select p.proname as name,
         pg_get_function_identity_arguments(p.oid) as args,
         pg_get_function_result(p.oid) as returns,
         p.prorettype = 'trigger'::regtype as is_trigger,
         has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
         has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role,
         (select split_part(c, '=', 2) from unnest(p.proconfig) c where c like 'search_path=%') as search_path,
         p.prosrc as body
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prokind = 'f'
  order by is_trigger, p.proname`;
const migrationCount = (
  await sql<{ n: number }[]>`select count(*)::int as n from drizzle.__drizzle_migrations`
)[0]?.n;
await sql.end();

const testDir = fileURLToPath(new URL('../__tests__/', import.meta.url));
const tests = readdirSync(testDir)
  .filter((f) => f.endsWith('.test.ts'))
  .map((f) => ({ file: f, text: readFileSync(`${testDir}${f}`, 'utf8') }));
const testedBy = (name: string) =>
  tests
    .filter((t) => t.text.includes(name))
    .map((t) => t.file.replace('.test.ts', ''))
    .sort();

/** Признаки проверки актёра в теле. Указатель, а не доказательство. */
const MARKERS: [string, RegExp][] = [
  ['auth.uid()', /auth\.uid\(\)/],
  ['current_role()', /current_role\(\)/],
  ['current_company_id()', /current_company_id\(\)/],
  ['role=service_role', /current_setting\('role'/],
  ['token', /\.token\s*=\s*p_token/],
  ['is_staff_user', /is_staff_user/],
];

/**
 * Ручной разбор функций, которые скрипт пометил (нет признака проверки актёра
 * или нет теста с именем). Написан человеком 2026-09-20 по телу функции и может
 * устареть: при изменении функции перечитайте его. Скрипт этого не проверяет.
 */
const REVIEW_NOTES: Record<string, string> = {
  buyer_company_ids_for_current_supplier:
    'делегирует supplier_can_access_rfq, а тот опирается на auth.uid(); собственной проверки не нужно',
  rfq_request_ids_for_current_supplier:
    'делегирует supplier_can_access_rfq (auth.uid()); собственной проверки не нужно',
  supplier_can_access_plan_line:
    'итоговый предикат — supplier_can_access_order (auth.uid()); чужому вызывающему отдаёт false, произвольный supplier_company_id сам по себе ничего не раскрывает',
  supplier_can_access_order:
    'проверяется косвенно через RLS-политики (supplier-isolation, attachment-isolation), по имени в тестах не упомянута',
  supplier_can_access_rfq:
    'проверяется косвенно через RLS-политики (supplier-isolation), по имени в тестах не упомянута',
  is_staff_user:
    'P3: любой вошедший может спросить, является ли произвольный UUID сотрудником QAJET; нужна RLS-политикам для чужих user_id, SECURITY DEFINER — чтобы читать users в обход RLS; эксплуатация требует знать UUID',
};

const yes = (b: boolean) => (b ? 'да' : '—');
const callable = rows.filter((r) => !r.is_trigger);
const triggers = rows.filter((r) => r.is_trigger);

const lines: string[] = [];
lines.push('# Опись SECURITY DEFINER-функций');
lines.push('');
lines.push(
  `Сгенерировано \`pnpm --filter @qajet/db db:inventory\` по каталогу локальной БД (${migrationCount} применённых миграций). Не редактировать руками: правки пропадут.`,
);
lines.push('');
lines.push(
  'Здесь только то, что можно измерить. **Не измеряется**: достаточна ли проверка внутри тела и почему нужен именно `SECURITY DEFINER` (а не `SECURITY INVOKER`). Признак в теле — указатель, куда смотреть, а не доказательство корректности; функция, доступная `authenticated` и без признаков, — повод для ручного разбора.',
);
lines.push('');
lines.push('## Итоги');
lines.push('');
lines.push(
  `- всего SECURITY DEFINER: **${rows.length}** (вызываемые RPC: **${callable.length}**, триггерные: **${triggers.length}**)`,
);
lines.push(`- доступны \`anon\`: **${callable.filter((r) => r.anon).length}**`);
lines.push(`- доступны \`authenticated\`: **${callable.filter((r) => r.authenticated).length}**`);
lines.push(
  `- только \`service_role\`: **${callable.filter((r) => !r.anon && !r.authenticated && r.service_role).length}**`,
);
lines.push(
  `- без закреплённого \`search_path\`: **${rows.filter((r) => r.search_path !== '""').length}**`,
);
lines.push(
  `- вызываемые без единого теста, упоминающего имя: **${callable.filter((r) => testedBy(r.name).length === 0).length}**`,
);
lines.push(
  `- вызываемые для \`authenticated\` без признаков проверки актёра: **${callable.filter((r) => r.authenticated && !r.anon && !MARKERS.some(([, re]) => re.test(r.body))).length}** (см. отметку ⚠ ниже)`,
);
lines.push(
  `- триггерные функции, доступные \`anon\` или \`authenticated\`: **${triggers.filter((r) => r.anon || r.authenticated).length}**`,
);
lines.push('');
lines.push('## Вызываемые RPC');
lines.push('');
lines.push(
  '| Функция | anon | authenticated | service_role | search_path | признаки проверки в теле | упоминают тесты | разбор вручную (2026-09-20) |',
);
lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of callable) {
  const found = MARKERS.filter(([, re]) => re.test(r.body)).map(([n]) => n);
  const flag = r.authenticated && !r.anon && found.length === 0 ? ' ⚠' : '';
  const tested = testedBy(r.name);
  lines.push(
    `| \`${r.name}(${r.args})\` | ${yes(r.anon)} | ${yes(r.authenticated)} | ${yes(r.service_role)} | ${r.search_path === '""' ? "`''`" : `**${r.search_path ?? 'не задан'}**`} | ${found.length ? found.join(', ') : '—'}${flag} | ${tested.length ? tested.join(', ') : '**нет**'} | ${REVIEW_NOTES[r.name] ?? ''} |`,
  );
}
lines.push('');
lines.push('## Триггерные функции');
lines.push('');
lines.push(
  `Ни одна не должна быть доступна \`anon\` или \`authenticated\` (миграции 0042 и 0052, тест \`function-privileges\`). Выполняются только как триггеры. Всего: ${triggers.length}; открытых: ${triggers.filter((r) => r.anon || r.authenticated).length}.`,
);
lines.push('');
lines.push(triggers.map((r) => `\`${r.name}\``).join(', '));
lines.push('');
lines.push(
  'Замечание: сюда попадают только триггерные функции `SECURITY DEFINER`. Триггерные функции `SECURITY INVOKER` в опись не входят, но закрыты той же миграцией 0052 и тем же тестом.',
);
lines.push('');

const out = fileURLToPath(
  new URL('../../../../docs/security/security-definer-inventory.md', import.meta.url),
);
writeFileSync(out, `${lines.join('\n').trimEnd()}\n`, 'utf8');
console.log(`Записано ${out}: ${rows.length} функций.`);
