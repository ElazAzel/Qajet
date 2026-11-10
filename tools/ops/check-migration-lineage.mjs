/** Offline comparison only. Never connects to a database or executes migration SQL. */
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

function regularFile(path, root) {
  if (!lstatSync(path).isFile()) throw new Error('Input must be a regular, non-symlink file.');
  if (root && !realpathSync(path).startsWith(`${root}${sep}`)) {
    throw new Error('Migration input resolves outside the migration directory.');
  }
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) {
      throw new Error('Input must be a regular file of at most 8 MiB.');
    }
    return readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
}

function jsonFile(path, root) {
  try {
    return JSON.parse(regularFile(path, root));
  } catch {
    throw new Error('Cannot read a valid JSON input file.');
  }
}

function timestamp(value) {
  const number = typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value;
  return typeof number === 'number' && Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function readSource(migrationsDir) {
  const root = realpathSync(migrationsDir);
  const journal = jsonFile(resolve(root, 'meta/_journal.json'), root);
  if (
    journal?.version !== '7' ||
    journal.dialect !== 'postgresql' ||
    !Array.isArray(journal.entries) ||
    journal.entries.length === 0
  ) {
    throw new Error('Expected a nonempty PostgreSQL version 7 migration journal.');
  }
  let previousWhen = 0;
  const tags = new Set();
  const source = journal.entries.map((entry, index) => {
    if (
      entry?.idx !== index ||
      entry.version !== '7' ||
      typeof entry.when !== 'number' ||
      timestamp(entry.when) === null ||
      entry.when <= previousWhen ||
      typeof entry.breakpoints !== 'boolean' ||
      typeof entry.tag !== 'string' ||
      !/^\d{4}_[a-z0-9_]+$/.test(entry.tag) ||
      !entry.tag.startsWith(`${String(index).padStart(4, '0')}_`) ||
      tags.has(entry.tag)
    ) {
      throw new Error(`Invalid, duplicated, or out-of-order journal entry at index ${index}.`);
    }
    previousWhen = entry.when;
    tags.add(entry.tag);
    let sql;
    try {
      sql = regularFile(resolve(root, `${entry.tag}.sql`), root);
    } catch {
      throw new Error(`Missing or unreadable SQL for ${entry.tag}.`);
    }
    if (!sql.trim()) throw new Error(`Empty SQL for ${entry.tag}.`);
    // Drizzle 0.45.2 hashes the complete UTF-8 SQL file, including comments/whitespace.
    return {
      tag: entry.tag,
      when: entry.when,
      hash: createHash('sha256').update(sql).digest('hex'),
    };
  });
  for (const name of readdirSync(root)) {
    if (name.endsWith('.sql') && !tags.has(name.slice(0, -4))) {
      throw new Error(`SQL file is absent from the journal: ${name}.`);
    }
  }
  return source;
}

export function compareLedger(source, rows) {
  if (!Array.isArray(source) || source.length === 0)
    throw new Error('Expected validated source migrations.');
  const tags = new Set();
  let previousWhen = 0;
  for (const entry of source) {
    if (
      typeof entry?.when !== 'number' ||
      timestamp(entry.when) === null ||
      entry.when <= previousWhen ||
      typeof entry.tag !== 'string' ||
      !entry.tag ||
      tags.has(entry.tag) ||
      typeof entry.hash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(entry.hash)
    ) {
      throw new Error('Invalid or duplicated source migration.');
    }
    previousWhen = entry.when;
    tags.add(entry.tag);
  }
  if (!Array.isArray(rows)) throw new Error('Expected an array of applied ledger rows.');
  const applied = new Map();
  const ids = new Set();
  for (const row of rows) {
    const when = timestamp(row?.created_at);
    if (
      !Number.isSafeInteger(row?.id) ||
      row.id <= 0 ||
      row.id > 2147483647 ||
      ids.has(row.id) ||
      when === null ||
      applied.has(when) ||
      typeof row.hash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(row.hash)
    ) {
      throw new Error('Invalid or duplicate applied ledger row.');
    }
    ids.add(row.id);
    applied.set(when, row.hash);
  }
  const sourceByWhen = new Map(source.map((entry) => [entry.when, entry]));
  const problems = [];
  const latest = Math.max(0, ...applied.keys());
  for (const [when, hash] of applied) {
    const entry = sourceByWhen.get(when);
    if (!entry) problems.push({ code: 'UNKNOWN_APPLIED_MIGRATION', when });
    else if (entry.hash !== hash) {
      problems.push({ code: 'APPLIED_SQL_HASH_MISMATCH', tag: entry.tag, when });
    }
  }
  const pending = [];
  for (const entry of source) {
    if (applied.has(entry.when)) continue;
    if (entry.when <= latest) {
      problems.push({ code: 'WOULD_BE_SKIPPED_BY_DRIZZLE', tag: entry.tag, when: entry.when });
    } else {
      pending.push(entry.tag);
    }
  }
  return {
    status: problems.length ? 'BLOCKED' : 'CONSISTENT_WITH_SUPPLIED_LEDGER',
    scope: 'offline-migration-lineage-only',
    productionVerified: false,
    releaseReadiness: 'NOT_CHECKED',
    appliedCount: applied.size,
    latestAppliedTimestamp: latest || null,
    pending,
    problems,
  };
}

export function main(args) {
  if (args.length < 1 || args.length > 2) {
    console.error(
      'Usage: node tools/ops/check-migration-lineage.mjs <migrations-dir> [applied-ledger.json]',
    );
    return 1;
  }
  try {
    const source = readSource(resolve(args[0]));
    if (!args[1]) {
      console.log(
        JSON.stringify({
          status: 'LEDGER_NOT_PROVIDED',
          scope: 'offline-migration-lineage-only',
          productionVerified: false,
          releaseReadiness: 'NOT_CHECKED',
          sourceMigrationCount: source.length,
        }),
      );
      return 2;
    }
    const report = compareLedger(source, jsonFile(resolve(args[1])));
    console.log(JSON.stringify(report, null, 2));
    return report.problems.length ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Invalid migration lineage input.');
    return 1;
  }
}

function invokedAsMain() {
  try {
    return (
      process.argv[1] &&
      realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
    );
  } catch {
    return false;
  }
}

if (invokedAsMain()) {
  process.exitCode = main(process.argv.slice(2));
}
