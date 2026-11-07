import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./summarize-gates.mjs', import.meta.url));
const sha = 'a'.repeat(40);

function summarize(t, needs, strict) {
  const root = mkdtempSync(join(tmpdir(), 'E2E-gate-summary-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const summary = join(root, 'summary.md');
  writeFileSync(summary, 'Existing summary\n');
  const env = { GITHUB_SHA: sha, GITHUB_STEP_SUMMARY: summary };
  if (needs !== undefined) env.NEEDS_JSON = needs;
  const result = spawnSync(process.execPath, [script, ...(strict ? ['--require-all'] : [])], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  const artifact = join(root, 'gates.json');
  return {
    ...result,
    artifact: existsSync(artifact) ? JSON.parse(readFileSync(artifact, 'utf8')) : null,
    summary: readFileSync(summary, 'utf8'),
  };
}

for (const strict of [false, true]) {
  const mode = strict ? 'strict' : 'report-only';

  test(`${mode}: successful gates retain their SHA, artifact and appended summary`, (t) => {
    const result = summarize(t, JSON.stringify({ build: { result: 'success' } }), strict);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.artifact, { commit: sha, gates: { build: 'PASS' } });
    assert.match(result.stdout, /\| build \| PASS \|/);
    assert.match(result.summary, /^Existing summary\n### Gates for aaaaaaa\n/);
    assert.match(result.summary, /\| build \| PASS \|/);
  });

  test(`${mode}: a failed gate is never successful`, (t) => {
    const result = summarize(t, JSON.stringify({ build: { result: 'failure' } }), strict);
    assert.equal(result.status, 1);
    assert.equal(result.artifact.gates.build, 'FAIL');
  });

  for (const outcome of [
    'skipped',
    'cancelled',
    'unknown',
    'constructor',
    'toString',
    '__proto__',
  ]) {
    test(`${mode}: ${outcome} remains NOT RUN`, (t) => {
      const result = summarize(t, JSON.stringify({ build: { result: outcome } }), strict);
      assert.equal(result.status, strict ? 1 : 0);
      assert.equal(result.artifact.gates.build, 'NOT RUN');
    });
  }

  for (const info of [{ result: ['success'] }, { result: null }, {}, null, true, 'success', []]) {
    test(`${mode}: malformed job result ${JSON.stringify(info)} remains NOT RUN`, (t) => {
      const result = summarize(t, JSON.stringify({ build: info }), strict);
      assert.equal(result.status, strict ? 1 : 0);
      assert.equal(result.artifact.gates.build, 'NOT RUN');
    });
  }

  for (const [name, needs] of [
    ['missing input', undefined],
    ['empty object', '{}'],
  ]) {
    test(`${mode}: ${name} cannot approve a strict gate`, (t) => {
      const result = summarize(t, needs, strict);
      assert.equal(result.status, strict ? 1 : 0);
      assert.deepEqual(result.artifact, { commit: sha, gates: {} });
      if (strict) assert.match(result.stderr, /NOT RUN/);
    });
  }

  for (const input of ['[]', '[{"result":"success"}]', 'null', 'true', '42', '"success"']) {
    test(`${mode}: invalid job-map input ${input} is rejected`, (t) => {
      const result = summarize(t, input, strict);
      assert.equal(result.status, 1);
      assert.equal(result.artifact, null);
      assert.match(result.stderr, /NEEDS_JSON/);
    });
  }

  test(`${mode}: malformed JSON cannot approve a gate`, (t) => {
    const result = summarize(t, '{bad', strict);
    assert.notEqual(result.status, 0);
    assert.equal(result.artifact, null);
  });
}
