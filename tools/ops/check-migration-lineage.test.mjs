import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compareLedger, readSource } from './check-migration-lineage.mjs';

const cli = fileURLToPath(new URL('./check-migration-lineage.mjs', import.meta.url));

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'qajet-lineage-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'meta'));
  const entries = [1000, 2000, 3000].map((when, idx) => ({
    idx,
    version: '7',
    when,
    tag: `${String(idx).padStart(4, '0')}_synthetic`,
    breakpoints: true,
  }));
  const journal = { version: '7', dialect: 'postgresql', entries };
  const save = () => writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify(journal));
  save();
  for (const entry of entries) {
    writeFileSync(join(dir, `${entry.tag}.sql`), `-- synthetic ${entry.idx}\nselect 1;\n`);
  }
  return { dir, journal, save };
}

function ledger(source) {
  return source.map((entry, idx) => ({ id: idx + 1, hash: entry.hash, created_at: entry.when }));
}

test('source hashes match Drizzle UTF-8 file hashing and preserve line endings', (t) => {
  const { dir } = fixture(t);
  const source = readSource(dir);
  const sql = readFileSync(join(dir, `${source[0].tag}.sql`), 'utf8');
  assert.equal(source[0].hash, createHash('sha256').update(sql).digest('hex'));
  writeFileSync(join(dir, `${source[0].tag}.sql`), sql.replaceAll('\n', '\r\n'));
  assert.notEqual(readSource(dir)[0].hash, source[0].hash);
});

test('matching unordered ledger with string timestamps is consistent, not release approval', (t) => {
  const source = readSource(fixture(t).dir);
  const rows = ledger(source)
    .reverse()
    .map((row) => ({ ...row, created_at: String(row.created_at) }));
  const report = compareLedger(source, rows);
  assert.equal(report.status, 'CONSISTENT_WITH_SUPPLIED_LEDGER');
  assert.equal(report.productionVerified, false);
  assert.equal(report.releaseReadiness, 'NOT_CHECKED');
  assert.deepEqual(report.pending, []);
  assert.deepEqual(report.problems, []);
});

test('new database and strict prefix identify pending migrations without claiming applied', (t) => {
  const source = readSource(fixture(t).dir);
  assert.deepEqual(
    compareLedger(source, []).pending,
    source.map((entry) => entry.tag),
  );
  assert.deepEqual(compareLedger(source, ledger(source).slice(0, 2)).pending, [source[2].tag]);
});

test('missing earlier migration is blocked because Drizzle would silently skip it', (t) => {
  const source = readSource(fixture(t).dir);
  const report = compareLedger(source, [ledger(source)[2]]);
  assert.equal(report.status, 'BLOCKED');
  assert.deepEqual(
    report.problems.map((problem) => problem.code),
    ['WOULD_BE_SKIPPED_BY_DRIZZLE', 'WOULD_BE_SKIPPED_BY_DRIZZLE'],
  );
});

test('changed applied SQL and unknown migration lineage are blocked', (t) => {
  const source = readSource(fixture(t).dir);
  const rows = ledger(source);
  rows[0].hash = 'a'.repeat(64);
  rows.push({ id: 4, hash: 'b'.repeat(64), created_at: 4000 });
  assert.deepEqual(
    compareLedger(source, rows).problems.map((problem) => problem.code),
    ['APPLIED_SQL_HASH_MISMATCH', 'UNKNOWN_APPLIED_MIGRATION'],
  );
});

test('renaming a migration without moving its old timestamp does not bypass skip detection', (t) => {
  const source = readSource(fixture(t).dir);
  const rows = [{ id: 1, hash: 'a'.repeat(64), created_at: 5000 }];
  const report = compareLedger(
    source.map((entry) => ({ ...entry, tag: `renamed_${entry.tag}` })),
    rows,
  );
  assert.equal(
    report.problems.filter((problem) => problem.code === 'WOULD_BE_SKIPPED_BY_DRIZZLE').length,
    3,
  );
});

for (const bad of [null, {}, '[]', [null], [{ id: 1, hash: 'x', created_at: 1 }]]) {
  test(`rejects invalid ledger shape ${JSON.stringify(bad)}`, (t) => {
    assert.throws(() => compareLedger(readSource(fixture(t).dir), bad));
  });
}

for (const value of [null, '', '01', '1.5', '1e3', true, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  test(`rejects invalid ledger timestamp ${JSON.stringify(value)}`, (t) => {
    const source = readSource(fixture(t).dir);
    const rows = ledger(source);
    rows[0].created_at = value;
    assert.throws(() => compareLedger(source, rows));
  });
}

for (const field of ['id', 'created_at']) {
  test(`rejects duplicate ledger ${field}`, (t) => {
    const source = readSource(fixture(t).dir);
    const rows = ledger(source);
    rows[1][field] = rows[0][field];
    assert.throws(() => compareLedger(source, rows));
  });
}

for (const mutate of [
  (j) => {
    j.entries = [];
  },
  (j) => {
    j.version = '6';
  },
  (j) => {
    j.dialect = 'mysql';
  },
  (j) => {
    j.entries[1].when = 1000;
  },
  (j) => {
    j.entries[1].when = 999;
  },
  (j) => {
    j.entries[1].when = '2000';
  },
  (j) => {
    j.entries[1].idx = 0;
  },
  (j) => {
    j.entries[1].tag = '../outside';
  },
  (j) => {
    j.entries[1].tag = '0000_synthetic';
  },
  (j) => {
    j.entries[1].breakpoints = null;
  },
]) {
  test(`rejects invalid journal: ${mutate.toString()}`, (t) => {
    const { dir, journal, save } = fixture(t);
    mutate(journal);
    save();
    assert.throws(() => readSource(dir));
  });
}

test('rejects SQL that is missing, empty, or not listed in journal', (t) => {
  const { dir } = fixture(t);
  const file = join(dir, '0000_synthetic.sql');
  rmSync(file);
  assert.throws(() => readSource(dir), /Missing/);
  writeFileSync(file, ' \n');
  assert.throws(() => readSource(dir), /Empty/);
  writeFileSync(file, 'select 1;');
  writeFileSync(join(dir, '0099_orphan.sql'), 'select 1;');
  assert.throws(() => readSource(dir), /absent/);
});

test('CLI without ledger exits 2, even when source is valid', (t) => {
  const { dir } = fixture(t);
  const result = spawnSync(process.execPath, [cli, dir], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).status, 'LEDGER_NOT_PROVIDED');
});

test('CLI gives distinct consistent and blocked outcomes without writing inputs', (t) => {
  const { dir } = fixture(t);
  const rows = ledger(readSource(dir));
  const file = join(dir, 'ledger.json');
  const text = JSON.stringify(rows);
  writeFileSync(file, text);
  const valid = spawnSync(process.execPath, [cli, dir, file], { encoding: 'utf8' });
  assert.equal(valid.status, 0);
  assert.equal(JSON.parse(valid.stdout).releaseReadiness, 'NOT_CHECKED');
  assert.equal(readFileSync(file, 'utf8'), text);
  rows[0].hash = 'f'.repeat(64);
  writeFileSync(file, JSON.stringify(rows));
  const blocked = spawnSync(process.execPath, [cli, dir, file], { encoding: 'utf8' });
  assert.equal(blocked.status, 1);
  assert.equal(JSON.parse(blocked.stdout).status, 'BLOCKED');
});

test('CLI rejects missing inputs and malformed JSON without exposing file contents', (t) => {
  const { dir } = fixture(t);
  const file = join(dir, 'ledger.json');
  writeFileSync(file, 'PRIVATE_TEST_CONTENT');
  for (const args of [[], [dir, file], [dir, join(dir, 'missing.json')], [dir, file, 'extra']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stderr, /PRIVATE_TEST_CONTENT/);
  }
});

test('CLI invoked through a symlink still validates arguments and does not silently succeed', {
  skip: process.platform === 'win32',
}, (t) => {
  const { dir } = fixture(t);
  const alias = join(dir, 'checker.mjs');
  symlinkSync(cli, alias);
  for (const args of [[], [join(dir, 'missing')]]) {
    const result = spawnSync(process.execPath, [alias, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.length);
  }
  assert.equal(spawnSync(process.execPath, [alias, dir], { encoding: 'utf8' }).status, 2);
  assert.equal(
    spawnSync(process.execPath, ['--preserve-symlinks-main', alias, dir], { encoding: 'utf8' })
      .status,
    2,
  );
});

test('rejects SQL and ledger symlinks rather than reading their targets', {
  skip: process.platform === 'win32',
}, (t) => {
  const { dir } = fixture(t);
  const outside = fixture(t).dir;
  const sql = join(dir, '0000_synthetic.sql');
  rmSync(sql);
  symlinkSync(join(outside, '0000_synthetic.sql'), sql);
  assert.throws(() => readSource(dir), /unreadable/);
  rmSync(sql);
  writeFileSync(sql, 'select 1;');
  const ledgerLink = join(dir, 'ledger.json');
  symlinkSync(join(outside, 'meta/_journal.json'), ledgerLink);
  assert.equal(spawnSync(process.execPath, [cli, dir, ledgerLink], { encoding: 'utf8' }).status, 1);
});

test('rejects journal directory symlinks escaping the selected migration directory', {
  skip: process.platform === 'win32',
}, (t) => {
  const { dir } = fixture(t);
  const outside = fixture(t).dir;
  rmSync(join(dir, 'meta'), { recursive: true });
  symlinkSync(join(outside, 'meta'), join(dir, 'meta'));
  assert.throws(() => readSource(dir));
});

test('rejects oversized input and directories where SQL files are required', (t) => {
  const { dir } = fixture(t);
  const path = join(dir, '0000_synthetic.sql');
  writeFileSync(path, 'x'.repeat(8 * 1024 * 1024 + 1));
  assert.throws(() => readSource(dir), /unreadable/);
  rmSync(path);
  mkdirSync(path);
  assert.throws(() => readSource(dir), /unreadable/);
});

test('rejects a FIFO SQL input promptly instead of waiting for a writer', {
  skip: process.platform === 'win32',
}, (t) => {
  const { dir } = fixture(t);
  const path = join(dir, '0000_synthetic.sql');
  rmSync(path);
  const create = spawnSync('mkfifo', [path], { encoding: 'utf8' });
  if (create.error?.code === 'ENOENT') return t.skip('mkfifo is not installed');
  assert.equal(create.status, 0);
  const result = spawnSync(process.execPath, [cli, dir], { encoding: 'utf8', timeout: 2000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
});

test('ledger IDs must fit the default SERIAL schema', (t) => {
  const source = readSource(fixture(t).dir);
  const rows = ledger(source);
  rows[0].id = 2147483647;
  assert.equal(compareLedger(source, rows).problems.length, 0);
  for (const id of [2147483648, Number.MAX_SAFE_INTEGER, -1, 0, 1.5, '1']) {
    rows[0].id = id;
    assert.throws(() => compareLedger(source, rows));
  }
});

test('exported comparator rejects unvalidated or duplicate source manifests', (t) => {
  const source = readSource(fixture(t).dir);
  for (const input of [
    [],
    null,
    {},
    [null],
    [{ ...source[0], when: '1000' }],
    [{ ...source[0], hash: 'bad' }],
    [source[0], source[0]],
    [...source].reverse(),
  ]) {
    assert.throws(() => compareLedger(input, []));
  }
});

test('invalid source without a ledger still exits 1 and cannot report valid source', (t) => {
  const { dir } = fixture(t);
  writeFileSync(join(dir, 'meta/_journal.json'), 'PRIVATE_INVALID_JSON');
  const result = spawnSync(process.execPath, [cli, dir], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.doesNotMatch(result.stderr, /PRIVATE_INVALID_JSON/);
});
