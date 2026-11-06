import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isReadyResponse, releaseManifestProblems } from './release-contract.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const strict = process.argv.includes('--strict');
let expectedSha;
let checkoutProblems = 0;
try {
  expectedSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (
    strict &&
    execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()
  ) {
    console.error('Release gate: strict требует чистый checkout выпускаемого SHA.');
    checkoutProblems++;
  }
} catch {
  if (strict) {
    console.error('Release gate: SHA исходников не подтверждён.');
    checkoutProblems++;
  }
}

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
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
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
const evidenceArg = process.argv.find((arg) => arg.startsWith('--evidence='));
const readinessFile = resolve(
  root,
  evidenceArg?.slice('--evidence='.length) || 'docs/release/readiness.json',
);
if (existsSync(readinessFile)) {
  try {
    const readiness = JSON.parse(readFileSync(readinessFile, 'utf8'));
    for (const problem of releaseManifestProblems(readiness, strict, expectedSha)) {
      console.error(`Release gate: ${problem}.`);
      readinessProblems++;
    }
  } catch {
    console.error('Release gate: docs/release/readiness.json не является корректным JSON.');
    readinessProblems++;
  }
}

if (!existsSync(readinessFile)) {
  console.error('Release gate: release evidence отсутствует.');
  readinessProblems++;
}

let readyProblems = 0;
if (readyUrl) {
  try {
    const response = await fetch(new URL('/api/ready', readyUrl), {
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    if (!(await isReadyResponse(response, expectedSha))) {
      console.error('Release gate: /api/ready не подтвердил безопасный JSON-контракт готовности.');
      readyProblems++;
    } else {
      console.log(
        'Release gate: /api/ready подтвердил runtime configuration. Внешние проверки обязательны отдельно.',
      );
    }
  } catch {
    console.error('Release gate: не удалось проверить /api/ready.');
    readyProblems++;
  }
} else if (strict) {
  console.error('Release gate: в строгом режиме нужен --ready-url=<адрес развёртывания>.');
  readyProblems++;
}

const hardFailures =
  checkoutProblems + missingFiles.length + (featureLlmEnabled ? 1 : 0) + readinessProblems;
const strictFailures = strict ? missingEnv.length + readyProblems : readyProblems;
if (hardFailures + strictFailures > 0) process.exit(2);

console.log(
  `Release gate: source=${requiredFiles.length - missingFiles.length}/${requiredFiles.length}, ` +
    `environment=${requiredEnv.length - missingEnv.length}/${requiredEnv.length}, mode=${strict ? 'strict' : 'non-strict'}.`,
);
