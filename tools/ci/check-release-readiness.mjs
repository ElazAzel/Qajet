import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const strict = process.argv.includes('--strict');
// --ready-url=https://host: в строгом режиме проверяет, что развёрнутое приложение
// действительно готово. Локальный успех lint/build не доказывает поведение
// продакшена — раньше именно так «готовый» статус жил рядом с /api/ready = 503.
const readyUrlArg = process.argv.find((arg) => arg.startsWith('--ready-url='));
const readyUrl = readyUrlArg?.slice('--ready-url='.length);
const requiredFiles = [
  'apps/web/app/api/health/route.ts',
  'apps/web/app/api/ready/route.ts',
  'apps/web/app/api/jobs/outbox/route.ts',
  'apps/web/app/api/jobs/learning/route.ts',
  'packages/engine/src/combine/combine.ts',
  'packages/engine/src/settlement/calculate.ts',
  'packages/db/migrations/0036_chemical_crusher_hogan.sql',
  'tools/dev/bootstrap.mjs',
  'vercel.json',
  'docs/release/readiness.json',
];
const requiredEnv = [
  'NEXT_PUBLIC_SITE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL',
  'LINK_SIGNING_SECRET',
  'CRON_SECRET',
];

const missingFiles = requiredFiles.filter((file) => !existsSync(resolve(root, file)));
if (missingFiles.length > 0) {
  console.error('Release gate: отсутствуют обязательные файлы:');
  for (const file of missingFiles) console.error(`- ${file}`);
}

const missingEnv = requiredEnv.filter((name) => !process.env[name]?.trim());
if (missingEnv.length > 0) {
  const message = `Release gate: отсутствуют обязательные переменные окружения (${missingEnv.join(', ')}).`;
  if (strict) console.error(message);
  else
    console.warn(
      `${message} Non-strict проверка продолжает работу; для production нужен --strict.`,
    );
}

const featureLlmEnabled = process.env.FEATURE_LLM_ASSIST?.toLowerCase() === 'true';
if (featureLlmEnabled) {
  console.error(
    'Release gate: FEATURE_LLM_ASSIST=true запрещён без отдельного reviewed enhancer с maskPII().',
  );
}

// Битый или неизвестный readiness.json — жёсткий отказ: по нему принимают решение о пилоте.
let readinessProblems = 0;
const readinessFile = resolve(root, 'docs/release/readiness.json');
if (existsSync(readinessFile)) {
  try {
    const readiness = JSON.parse(readFileSync(readinessFile, 'utf8'));
    if (readiness.schemaVersion !== 1) {
      console.error('Release gate: docs/release/readiness.json имеет неизвестную schemaVersion.');
      readinessProblems++;
    }
  } catch {
    console.error('Release gate: docs/release/readiness.json не является корректным JSON.');
    readinessProblems++;
  }
}

let readyProblems = 0;
if (readyUrl) {
  try {
    const response = await fetch(new URL('/api/ready', readyUrl), {
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.text();
    if (response.status !== 200) {
      console.error(
        `Release gate: ${readyUrl}/api/ready ответил ${response.status}: ${body.slice(0, 300)}`,
      );
      readyProblems++;
    } else {
      console.log(`Release gate: ${readyUrl}/api/ready = 200.`);
    }
  } catch (error) {
    console.error(
      `Release gate: не удалось запросить /api/ready: ${error instanceof Error ? error.message : error}`,
    );
    readyProblems++;
  }
} else if (strict) {
  console.error('Release gate: в строгом режиме нужен --ready-url=<адрес развёртывания>.');
  readyProblems++;
}

const hardFailures = missingFiles.length + (featureLlmEnabled ? 1 : 0) + readinessProblems;
const strictFailures = strict ? missingEnv.length + readyProblems : readyProblems;
if (hardFailures + strictFailures > 0) process.exit(2);

console.log(
  `Release gate: source=${requiredFiles.length - missingFiles.length}/${requiredFiles.length}, ` +
    `environment=${requiredEnv.length - missingEnv.length}/${requiredEnv.length}, mode=${strict ? 'strict' : 'non-strict'}.`,
);
