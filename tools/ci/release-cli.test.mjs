import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { REQUIRED_RELEASE_GATES } from './release-contract.mjs';

function fixture(t) {
  const temp = mkdtempSync(join(tmpdir(), 'qajet-release-cli-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const root = join(temp, 'checkout');
  const required = [
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
  for (const name of required) {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, name.endsWith('readiness.json') ? '{"schemaVersion":1}' : '// E2E fixture');
  }
  const source = dirname(fileURLToPath(import.meta.url));
  for (const name of ['check-release-readiness.mjs', 'release-contract.mjs']) {
    const path = join(root, 'tools/ci', name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, readFileSync(join(source, name)));
  }
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init');
  git('add', '.');
  git(
    '-c',
    'user.name=E2E Test',
    '-c',
    'user.email=e2e@example.test',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'E2E fixture',
  );
  const sha = git('rev-parse', 'HEAD');
  const evidence = join(temp, 'evidence.json');
  writeFileSync(
    evidence,
    JSON.stringify({
      schemaVersion: 1,
      status: 'ready-for-production',
      sourceSha: sha,
      gates: Object.fromEntries(
        REQUIRED_RELEASE_GATES.map((key) => [key, 'passed-local: E2E synthetic evidence']),
      ),
      gateSourceShas: Object.fromEntries(REQUIRED_RELEASE_GATES.map((key) => [key, sha])),
    }),
  );
  const stub = join(temp, 'fetch-stub.mjs');
  writeFileSync(
    stub,
    "globalThis.fetch=async()=>new Response(JSON.stringify({ok:true,dependency:'supabase',commit:process.env.E2E_RUNTIME_SHA}),{headers:{'content-type':'application/json'}});",
  );
  const env = { ...process.env, FEATURE_LLM_ASSIST: 'false', E2E_RUNTIME_SHA: sha };
  for (const name of [
    'NEXT_PUBLIC_SITE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'DATABASE_URL',
    'LINK_SIGNING_SECRET',
    'CRON_SECRET',
    'RESEND_API_KEY',
    'RESEND_FROM_EMAIL',
  ])
    env[name] = 'E2E-synthetic-only';
  return {
    root,
    git,
    env,
    run: () =>
      spawnSync(
        process.execPath,
        [
          '--import',
          stub,
          join(root, 'tools/ci/check-release-readiness.mjs'),
          '--strict',
          '--ready-url=https://unused.example.test',
          `--evidence=${evidence}`,
        ],
        { cwd: root, env, encoding: 'utf8' },
      ),
  };
}
test('real CLI accepts a clean checkout and matching external evidence/runtime SHA', (t) => {
  const f = fixture(t),
    r = f.run();
  assert.equal(r.status, 0, r.stderr);
});
for (const kind of ['unstaged', 'staged', 'untracked'])
  test(`real CLI refuses ${kind} changes`, (t) => {
    const f = fixture(t);
    writeFileSync(
      join(f.root, kind === 'untracked' ? 'E2E-untracked.txt' : 'vercel.json'),
      'E2E modification',
    );
    if (kind === 'staged') f.git('add', 'vercel.json');
    assert.equal(f.run().status, 2);
  });
test('real CLI refuses a deployment from another SHA', (t) => {
  const f = fixture(t);
  f.env.E2E_RUNTIME_SHA = '0'.repeat(40);
  assert.equal(f.run().status, 2);
});
