import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isReadyResponse,
  REQUIRED_RELEASE_GATES,
  releaseManifestProblems,
} from './release-contract.mjs';

const sha = 'a'.repeat(40);
test('strict release refuses unresolved or absent gates', () => {
  assert.ok(
    releaseManifestProblems({ schemaVersion: 1, status: 'not-ready-external-blockers' }, true)
      .length,
  );
  const manifest = {
    schemaVersion: 1,
    status: 'ready-for-production',
    sourceSha: sha,
    gateSourceShas: Object.fromEntries(REQUIRED_RELEASE_GATES.map((key) => [key, sha])),
    gates: Object.fromEntries(
      REQUIRED_RELEASE_GATES.map((key) => [key, 'passed-local: E2E evidence']),
    ),
  };
  assert.deepEqual(releaseManifestProblems(manifest, true, sha), []);
  manifest.gates.mailDelivery = 'not-run';
  assert.ok(
    releaseManifestProblems(manifest, true, sha).some((message) =>
      message.includes('mailDelivery'),
    ),
  );
});
test('non-strict source checks cannot be mistaken for strict release approval', () => {
  assert.deepEqual(
    releaseManifestProblems({ schemaVersion: 1, status: 'not-ready-external-blockers' }, false),
    [],
  );
  assert.ok(releaseManifestProblems(null, true).length);
});
test('readiness refuses HTML 200, false JSON, malformed JSON and redirects', async () => {
  const json = { 'content-type': 'application/json' };
  for (const response of [
    new Response('<html>login</html>'),
    new Response('{"ok":false}', { headers: json }),
    new Response('{bad', { headers: json }),
    new Response('{}', { status: 302, headers: json }),
  ]) {
    assert.equal(await isReadyResponse(response, sha), false);
  }
  assert.equal(
    await isReadyResponse(
      new Response(JSON.stringify({ ok: true, dependency: 'supabase', commit: sha }), {
        headers: json,
      }),
      sha,
    ),
    true,
  );
});

test('rejects stale source, per-gate and deployed runtime SHA', async () => {
  const manifest = {
    schemaVersion: 1,
    status: 'ready-for-production',
    sourceSha: sha,
    gates: Object.fromEntries(REQUIRED_RELEASE_GATES.map((key) => [key, 'passed-local: evidence'])),
    gateSourceShas: Object.fromEntries(REQUIRED_RELEASE_GATES.map((key) => [key, sha])),
  };
  assert.ok(releaseManifestProblems({ ...manifest, sourceSha: 'b'.repeat(40) }, true, sha).length);
  manifest.gateSourceShas.rlsSuite = 'b'.repeat(40);
  assert.ok(
    releaseManifestProblems(manifest, true, sha).some((message) => message.includes('rlsSuite')),
  );
  assert.equal(
    await isReadyResponse(
      new Response(JSON.stringify({ ok: true, dependency: 'supabase', commit: 'b'.repeat(40) }), {
        headers: { 'content-type': 'application/json' },
      }),
      sha,
    ),
    false,
  );
  for (const commit of [undefined, 'local']) {
    assert.equal(
      await isReadyResponse(
        new Response(JSON.stringify({ ok: true, dependency: 'supabase', commit }), {
          headers: { 'content-type': 'application/json' },
        }),
        sha,
      ),
      false,
    );
  }
});
