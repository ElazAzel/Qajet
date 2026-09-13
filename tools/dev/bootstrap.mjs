import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const envFile = resolve(repoRoot, '.env.local');

function commandResult(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    ...options,
  });
}

function fail(message) {
  console.error(`\nBootstrap остановлен: ${message}`);
  process.exit(1);
}

function assertCommand(command, args, message) {
  const result = commandResult(command, args, { stdio: 'ignore' });
  if (result.status !== 0) fail(message);
}

function run(command, args, env) {
  const result = commandResult(command, args, { stdio: 'inherit', env });
  if (result.status !== 0) fail(`${command} завершился с кодом ${result.status ?? 'unknown'}`);
}

function parseSupabaseEnv(output) {
  const values = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    const value = match[2].trim().replace(/^"(.*)"$/, '$1');
    values[match[1]] = value;
  }
  return values;
}

function upsertEnv(file, updates) {
  let content = '';
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    content = '';
  }
  const lines = content ? content.split(/\r?\n/) : [];
  const seen = new Set();
  const next = lines.map((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (!match || !(match[1] in updates)) return line;
    seen.add(match[1]);
    return `${match[1]}=${updates[match[1]]}`;
  });
  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) next.push(`${key}=${value}`);
  }
  while (next.length > 0 && next.at(-1) === '') next.pop();
  writeFileSync(file, `${next.join('\n')}\n`, 'utf8');
}

if (process.versions.node.localeCompare('22.12.0', undefined, { numeric: true }) < 0) {
  fail(`нужен Node.js 22.12+, найден ${process.version}`);
}

console.log('Проверяю локальные зависимости…');
assertCommand('corepack', ['pnpm', '--version'], 'не найден pnpm через Corepack');
assertCommand(
  'docker',
  ['info', '--format', '{{.ServerVersion}}'],
  'Docker Desktop не запущен. Запустите Docker Desktop и повторите pnpm dev:bootstrap.',
);
assertCommand('supabase', ['--version'], 'не найден Supabase CLI. Установите его перед bootstrap.');

let status = commandResult('supabase', ['status', '-o', 'env'], { stdio: 'pipe' });
if (status.status !== 0) {
  console.log('Запускаю локальный Supabase…');
  run('supabase', ['start'], process.env);
  status = commandResult('supabase', ['status', '-o', 'env'], { stdio: 'pipe' });
}
if (status.status !== 0) fail('Supabase не вернул локальные параметры после запуска.');

const supabaseEnv = parseSupabaseEnv(status.stdout ?? '');
const updates = {
  NEXT_PUBLIC_SUPABASE_URL: supabaseEnv.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseEnv.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: supabaseEnv.SERVICE_ROLE_KEY,
  DATABASE_URL: supabaseEnv.DB_URL,
  NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3000',
};
for (const [key, value] of Object.entries(updates)) {
  if (!value) fail(`Supabase status не содержит ${key === 'DATABASE_URL' ? 'DB_URL' : key}.`);
}

upsertEnv(envFile, updates);
const localEnv = { ...process.env, ...updates };
console.log('Локальные параметры записаны в .env.local (секреты не выводятся).');
console.log('Применяю миграции и пересоздаю только локальные demo-данные…');
run('corepack', ['pnpm', 'db:reset'], localEnv);
console.log('Запускаю QAJET на http://127.0.0.1:3000. Для остановки нажмите Ctrl+C.');

const dev = spawn('corepack', ['pnpm', 'dev'], {
  cwd: repoRoot,
  env: localEnv,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
dev.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
