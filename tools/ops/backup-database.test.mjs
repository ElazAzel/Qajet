import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// Execute the real CLI, intercepting every spawnSync call it currently uses.
// No Docker, database, network, production data or inherited credentials are used.
const preload = `
import childProcess from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const config = JSON.parse(process.env.BACKUP_TEST_CONFIG);
childProcess.spawnSync = (command, args, options = {}) => {
  if (command !== 'docker') throw new Error('Unexpected external command');
  let step;
  let stdout = '';
  if (args[0] === 'ps') { step = 'discover'; stdout = 'supabase_db_synthetic\\n'; }
  else if (args[0] === 'inspect') { step = 'image'; stdout = 'synthetic/supabase-postgres\\n'; }
  else if (args[0] === 'run') { step = 'start'; stdout = 'synthetic-container-id\\n'; }
  else if (args[0] === 'rm') { step = 'cleanup'; }
  else if (args.includes('pg_dump')) {
    step = args.includes('auth') ? 'dump-identity' : 'dump-business';
    stdout = 'synthetic archive';
  } else if (args.includes('pg_isready')) { step = 'ready'; }
  else if (args.includes('sleep')) { step = 'wait'; }
  else if (args.includes('pg_restore')) {
    step = args.includes('supabase_admin') ? 'restore-identity' : 'restore-business';
  } else if (args.includes('psql')) {
    if (args.some((arg) => arg.includes('pg_get_functiondef'))) {
      step = 'uid'; stdout = 'synthetic request.jwt.claims\\n';
    } else {
      step = args.includes('supabase_db_synthetic') ? 'count-source' : 'count-probe';
      stdout = '43/7/18\\n';
    }
  } else throw new Error('Unexpected Docker invocation');
  appendFileSync(process.env.BACKUP_TEST_TRACE, JSON.stringify({ step, args }) + '\\n');
  const override = config[step] ?? {};
  const result = { status: 0, signal: null, stdout, stderr: '', ...override };
  if (override.error) result.error = new Error('synthetic process error');
  if (options.encoding === 'buffer') {
    result.stdout = Buffer.from(result.stdout ?? '');
    result.stderr = Buffer.from(result.stderr ?? '');
  }
  return result;
};
syncBuiltinESMExports();
`;

function runBackup(t, config = {}, args = ['--verify']) {
  const root = mkdtempSync(join(tmpdir(), 'qajet-backup-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const ops = join(root, 'tools', 'ops');
  mkdirSync(ops, { recursive: true });
  const script = join(ops, 'backup-database.mjs');
  cpSync(new URL('./backup-database.mjs', import.meta.url), script);
  const hook = join(root, 'preload.mjs');
  const trace = join(root, 'trace.jsonl');
  writeFileSync(hook, preload);
  writeFileSync(trace, '');
  const result = spawnSync(
    process.execPath,
    ['--import', hook, script, '--url=postgresql://postgres@127.0.0.1:54322/postgres', ...args],
    {
      encoding: 'utf8',
      timeout: 10000,
      env: { BACKUP_TEST_CONFIG: JSON.stringify(config), BACKUP_TEST_TRACE: trace },
    },
  );
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  const calls = readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  return { ...result, calls, steps: calls.map((call) => call.step) };
}

function assertUnverified(result) {
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /ПРОВЕРЕНО:/);
  assert.equal(result.steps.at(-1), 'cleanup');
  assert.match(result.stderr, /проверка не удалась|РАСХОЖДЕНИЕ/);
}

test('successful restore and matching valid counts pass the limited readability check', (t) => {
  const result = runBackup(t);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ПРОВЕРЕНО:/);
  assert.match(result.stdout, /не полного восстановления/);
  assert.match(result.stdout, /Storage/);
  assert.deepEqual(result.steps.slice(-5), [
    'restore-identity',
    'restore-business',
    'count-probe',
    'count-source',
    'cleanup',
  ]);
});

for (const step of ['restore-identity', 'restore-business', 'count-probe', 'count-source']) {
  for (const [outcome, response] of [
    ['nonzero exit with plausible stdout', { status: 1 }],
    ['terminated by signal', { status: null, signal: 'SIGTERM' }],
    ['spawn error', { status: null, error: true }],
    ['missing exit status', { status: null }],
  ]) {
    test(`${step}: ${outcome} fails closed`, (t) => {
      const result = runBackup(t, { [step]: response });
      assertUnverified(result);
      if (step === 'restore-identity') assert.ok(!result.steps.includes('restore-business'));
      if (step.startsWith('restore-')) assert.ok(!result.steps.includes('count-probe'));
      if (step === 'count-probe') assert.ok(!result.steps.includes('count-source'));
    });
  }
}

for (const value of ['', 'not-a-count', '-1/7/18', '43/7', '43/7/18/1', '43/7/18\n43/7/18']) {
  test(`matching invalid output ${JSON.stringify(value)} is not evidence`, (t) => {
    const result = runBackup(t, {
      'count-probe': { stdout: value },
      'count-source': { stdout: value },
    });
    assertUnverified(result);
  });
}

for (const value of [null, '', 'not-a-count', '43/7/18\n43/7/18']) {
  test(`source-only invalid output ${JSON.stringify(value)} fails closed`, (t) => {
    const result = runBackup(t, { 'count-source': { stdout: value } });
    assertUnverified(result);
  });
}

test('a process error overrides even a zero exit status', (t) => {
  const result = runBackup(t, { 'restore-identity': { status: 0, error: true } });
  assertUnverified(result);
});

test('failed verification does not print raw command output', (t) => {
  const marker = 'synthetic-private-diagnostic';
  const result = runBackup(t, {
    'count-source': { status: 1, stdout: marker, stderr: marker },
  });
  assertUnverified(result);
  assert.ok(!(result.stdout + result.stderr).includes(marker));
});

test('different valid counts fail closed', (t) => {
  const result = runBackup(t, { 'count-probe': { stdout: '42/7/18\n' } });
  assertUnverified(result);
});

test('valid zero counts pass, without numeric coercion', (t) => {
  const result = runBackup(t, {
    'count-probe': { stdout: '0/0/0\n' },
    'count-source': { stdout: '0/0/0\n' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ПРОВЕРЕНО:/);
});

test('verification uses fail-fast restore and deterministic psql flags', (t) => {
  const result = runBackup(t);
  for (const call of result.calls.filter((call) => call.step.startsWith('restore-'))) {
    assert.ok(call.args.includes('--exit-on-error'));
  }
  for (const call of result.calls.filter((call) => call.step.startsWith('count-'))) {
    assert.ok(call.args.includes('-X'));
    assert.ok(call.args.includes('ON_ERROR_STOP=1'));
  }
});

test('readiness timeout does not restore and still removes the probe', (t) => {
  const result = runBackup(t, { ready: { status: 1 } });
  assertUnverified(result);
  assert.ok(!result.steps.includes('restore-identity'));
});

test('backup without --verify never starts a restore probe or claims verification', (t) => {
  const result = runBackup(t, {}, []);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /НЕ проверена/);
  assert.doesNotMatch(result.stdout, /ПРОВЕРЕНО:/);
  assert.ok(!result.steps.includes('start'));
});
