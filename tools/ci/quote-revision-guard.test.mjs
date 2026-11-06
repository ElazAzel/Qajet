import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

// Source contracts only. These do not replace PostgreSQL authorization tests.
const migrations = new URL('../../packages/db/migrations/', import.meta.url);
const definitions = readdirSync(migrations)
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort()
  .flatMap((name) => {
    const sql = readFileSync(new URL(name, migrations), 'utf8');
    return [...sql.matchAll(
      /CREATE OR REPLACE FUNCTION public\.request_supplier_quote_revision\([\s\S]*?\$\$;/g,
    )].map(([definition]) => ({ name, definition, sql }));
  });
const latest = definitions.at(-1);

test('the effective revision RPC fails closed when current_role() is NULL', () => {
  assert.ok(latest);
  assert.match(
    latest.definition,
    /IF auth\.uid\(\) IS NULL OR \(public\.current_role\(\) IN \('concierge', 'admin'\)\) IS NOT TRUE THEN/,
  );
  const denial = latest.definition.indexOf('Запросить исправление КП может только сотрудник QAJET');
  assert.ok(denial > 0 && denial < latest.definition.indexOf('SELECT * INTO v_rfq'));
});

test('the additive fix preserves every other line of the existing function', () => {
  const prior = definitions.find((entry) => entry.name === '0039_abandoned_randall_flagg.sql');
  const fix = definitions.find(
    (entry) => entry.name === '0059_quote_revision_null_safe_authorization.sql',
  );
  assert.ok(fix && prior);
  assert.equal(
    fix.definition,
    prior.definition.replace(
      "public.current_role() NOT IN ('concierge', 'admin')",
      "(public.current_role() IN ('concierge', 'admin')) IS NOT TRUE",
    ),
  );
});

test('the fix retains SECURITY DEFINER, empty search_path and restrictive grants', () => {
  assert.ok(latest);
  assert.match(latest.definition, /SECURITY DEFINER SET search_path = ''/);
  assert.match(
    latest.sql,
    /REVOKE ALL ON FUNCTION public\.request_supplier_quote_revision\(uuid, text\) FROM public, anon;/,
  );
  assert.match(
    latest.sql,
    /GRANT EXECUTE ON FUNCTION public\.request_supplier_quote_revision\(uuid, text\) TO authenticated;/,
  );
});

test('the new migration has a monotonic Drizzle journal entry', () => {
  assert.ok(latest);
  const { entries } = JSON.parse(readFileSync(new URL('meta/_journal.json', migrations), 'utf8'));
  const entry = entries.find((item) => `${item.tag}.sql` === latest.name);
  assert.ok(entry && entry.idx > 58);
  const previous = entries.find((item) => item.idx === entry.idx - 1);
  assert.ok(previous && entry.when > previous.when);
  assert.equal(entry.breakpoints, true);
});
