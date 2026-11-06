import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const workflow = readFileSync(new URL('../../.github/workflows/jobs.yml', import.meta.url), 'utf8');
const marker = '        run: |\n';
assert.equal(workflow.split(marker).length, 2, 'Expected one runnable workflow block');
const block = workflow
  .split(marker)[1]
  .split('\n')
  .map((line) => line.slice(10))
  .join('\n');
const clean = { status: '200', body: { ok: true, claimed: 0, failed: 0, errors: [] } };
const privateMarker = 'E2E-private-job-response@example.test';
const inheritedPath = process.env.PATH ?? '/usr/bin:/bin';
for (const command of ['bash', 'jq']) {
  const probe = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    env: { PATH: inheritedPath },
  });
  assert.equal(probe.status, 0, `Job workflow tests require ${command} on PATH`);
}

// Execute the real workflow shell body. Only legacy absolute temporary paths
// are namespaced; the command flow is unmodified. curl is always a local stub.
function runWorkflow(t, responses = {}, secret = 'E2E-cron-secret') {
  const root = mkdtempSync(join(tmpdir(), 'E2E-job-workflow-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const trace = join(root, 'trace.jsonl');
  writeFileSync(trace, '');
  const curl = join(root, 'curl');
  writeFileSync(
    curl,
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const url = args.at(-1);
if (!['ready', 'jobs/outbox', 'jobs/learning'].map((path) => 'https://E2E-jobs.invalid/api/' + path).includes(url)) throw new Error('Unexpected test URL');
const job = url.split('/').at(-1);
fs.appendFileSync(process.env.E2E_TRACE, JSON.stringify({ job, args }) + '\\n');
const response = JSON.parse(process.env.E2E_RESPONSES)[job];
const out = args[args.indexOf('-o') + 1];
if (!out.startsWith(process.env.TMPDIR + '/')) throw new Error('Output is outside test namespace');
fs.writeFileSync(out, typeof response.body === 'string' ? response.body : JSON.stringify(response.body));
process.stdout.write(response.status);
process.exit(response.exit ?? 0);
`,
  );
  chmodSync(curl, 0o755);
  const script = block
    .replaceAll('/tmp/ready.json', join(root, 'ready.json'))
    .replaceAll('/tmp/out.json', join(root, 'out.json'));
  const result = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      PATH: `${root}:${inheritedPath}`,
      TMPDIR: root,
      CRON_SECRET: secret,
      APP_URL: 'https://E2E-jobs.invalid',
      E2E_TRACE: trace,
      E2E_RESPONSES: JSON.stringify({ ready: clean, outbox: clean, learning: clean, ...responses }),
    },
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  const calls = readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  return { ...result, calls };
}

function bothOnce(result) {
  assert.deepEqual(
    result.calls.map((call) => call.job),
    ['ready', 'outbox', 'learning'],
  );
  for (const call of result.calls) {
    assert.ok(!call.args.some((arg) => arg.startsWith('--retry')));
    assert.equal(call.args[call.args.indexOf('--connect-timeout') + 1], '10');
    assert.equal(call.args[call.args.indexOf('--max-time') + 1], '45');
    if (call.job !== 'ready') {
      assert.equal(call.args[call.args.indexOf('-X') + 1], 'POST');
      assert.equal(call.args[call.args.indexOf('-H') + 1], 'Authorization: Bearer E2E-cron-secret');
    }
  }
}

test('both successful jobs run once and the workflow succeeds', (t) => {
  const result = runWorkflow(t);
  assert.equal(result.status, 0, result.stderr);
  bothOnce(result);
});

for (const job of ['outbox', 'learning']) {
  for (const [name, response] of [
    [
      'mixed failure',
      { ...clean, body: { ok: false, claimed: 2, failed: 1, errors: [privateMarker] } },
    ],
    [
      'all failed',
      { ...clean, body: { ok: false, claimed: 2, failed: 2, errors: [privateMarker] } },
    ],
    ['inconsistent ok with failed', { ...clean, body: { ok: true, failed: 1 } }],
    ['unconfirmed retry', { ...clean, body: { ok: true, failed: 0, retryUnconfirmed: 1 } }],
    ['HTTP 503', { status: '503', body: { error: privateMarker } }],
    ['network failure', { status: '000', body: privateMarker, exit: 7 }],
    ['timeout with unknown completion', { status: '000', body: privateMarker, exit: 28 }],
    ['invalid JSON', { ...clean, body: privateMarker }],
    ['empty body', { ...clean, body: '' }],
    ['multiple JSON values', { ...clean, body: '{"ok":false,"failed":1}\n{"ok":true,"failed":0}' }],
    ['missing failed', { ...clean, body: { ok: true } }],
    ['string failed', { ...clean, body: { ok: true, failed: '0' } }],
    ['null retry counter', { ...clean, body: { ok: true, failed: 0, retryUnconfirmed: null } }],
  ]) {
    test(`${job}: ${name} fails overall but does not skip the other job or retry`, (t) => {
      const result = runWorkflow(t, { [job]: response });
      assert.equal(result.status, 1, result.stdout + result.stderr);
      bothOnce(result);
      assert.ok(!(result.stdout + result.stderr).includes(privateMarker));
    });
  }
}

test('unavailable readiness is NOT RUN and never a successful workflow', (t) => {
  const result = runWorkflow(t, { ready: { status: '503', body: privateMarker } });
  assert.equal(result.status, 1);
  assert.deepEqual(
    result.calls.map((call) => call.job),
    ['ready'],
  );
  assert.match(result.stdout, /NOT RUN/);
  assert.ok(!(result.stdout + result.stderr).includes(privateMarker));
});

test('missing secret fails before any HTTP attempt', (t) => {
  const result = runWorkflow(t, {}, '');
  assert.equal(result.status, 1);
  assert.deepEqual(result.calls, []);
});

test('both failed jobs are each attempted once before the final failure', (t) => {
  const failed = { ...clean, body: { ok: false, failed: 1 } };
  const result = runWorkflow(t, { outbox: failed, learning: failed });
  assert.equal(result.status, 1);
  bothOnce(result);
});

test('root test command runs these regressions before Turbo', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const [nodeTests, turbo] = manifest.scripts.test.split(' && ');
  assert.ok(nodeTests.startsWith('node --test '));
  assert.ok(nodeTests.split(' ').includes('tools/ci/job-workflow.test.mjs'));
  assert.equal(turbo, 'turbo run test');
});
