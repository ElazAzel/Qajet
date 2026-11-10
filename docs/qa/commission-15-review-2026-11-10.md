# Qajet commission consistency candidate

Base: main `703300dffc23e0f1adbde18aff8706c03966fb8d` (2026-11-10).
Repository: https://github.com/ElazAzel/Qajet

## Result

The application patch uses the engine's 10–15% range and 15% default for admin
settings, the server-side settings action's shared validation, comparison fallback,
and seed defaults. Missing, obsolete and malformed commission settings cannot
produce a new plan above 15%. Existing plans are read separately and are not
repriced. Tests now reflect the intended commission contract.

A separate additive SQL candidate replaces `guard_plan_line_contract` with the
same function except bounds 10–15 and explicit NULL rejection. It preserves
permissions, hardened search_path, immutability, quote/request/supplier linkage,
and rounding tolerance. It does not update historical rows. The candidate is
NOT registered in the journal and its provisional filename is not an instruction
to apply it. Existing migration files were not changed.

## Confirmed root cause

Main's `settings-catalog.ts` still allows 21–24%. `comparison.ts` falls back to 23%.
Migration 0062 changes `guard_plan_line_commission` and the commission update RPC,
but not `guard_plan_line_contract` created by 0039. The latter rejects 10–15% on
both INSERT and UPDATE. These bounds are disjoint from 0062's UPDATE bounds.

- https://github.com/ElazAzel/Qajet/blob/703300dffc23e0f1adbde18aff8706c03966fb8d/packages/db/migrations/0039_abandoned_randall_flagg.sql#L528-L612
- https://github.com/ElazAzel/Qajet/blob/703300dffc23e0f1adbde18aff8706c03966fb8d/packages/db/migrations/0062_qajet_commission_15.sql

## Verification

- PASS: all source files in the initial local snapshot matched Git blob hashes
  from main's complete recursive tree before editing.
- FAIL then PASS: focused web regression tests, 16 failures / 8 passes before,
  24 / 24 passes after. Tests cover admin roles, valid boundaries, obsolete and
  malformed settings, actual calculated commission and buyer total.
- PASS: complete web unit suite, 44 files / 294 tests.
- PASS: complete engine suite, 14 files / 137 tests.
- PASS: named root CI-tool test command, 9 tests.
- PASS: engine and DB package typechecks; focused web changed-code typecheck.
- PASS: Biome check on all nine changed/new source/test files and git diff --check.
- FAIL: whole-repository lint, pre-existing formatting error in
  apps/web/app/startupbattle/page.tsx and a pre-existing optional-chain warning
  in tools/dev/local-supabase-env.mjs. Those files were not modified.
- FAIL / dependency blocker: whole-web typecheck, unavailable packages including
  lucide-react, recharts, Capacitor, Playwright, Serwist and several UI packages.
- NOT RUN: full web build, browser E2E, hosted providers, exact-commit CI/Vercel.

### Isolated PostgreSQL evidence

PostgreSQL 17.6 official native Supabase bundle, loopback port 55459, separate
copy of an unused local synthetic cluster with real Auth and Storage schemas.
Production was not contacted. No production database URL/credential was used.

1. FAIL: repository `pnpm --filter @qajet/db db:migrate` command cannot start tsx
   because its Unix IPC listener is rejected with EPERM. Do not label the
   official migration command or Drizzle deployment verified.
2. PASS: applied main's complete journal-ordered SQL via psql on the isolated
   local cluster, in one transaction. This validates SQL, not Drizzle deployment.
3. REPRODUCED: with main SQL only, updated commission tests fail (10 failures
   in the four-file focused suite), including 10/12.5/15% proposal insertion
   and editing to the new valid range. Old 21/23/24% insertion is accepted.
4. PASS: on a fresh isolated cluster, main SQL plus the separate additive
   candidate yields 29 files / 242 DB tests passing. No test skips.
5. PASS after the final assertion adjustment: focused commission test verifies
   direct 12% edit, RPC 15% edit, rejection of RPC 23%, total recalculation and
   refusal of a genuinely different valid rate after approval. One test ran,
   other 15 tests in that file deliberately skipped.
6. PASS: post-suite residue counts are zero for companies, auth/public users,
   and pg_net HTTP requests. Local PostgreSQL was stopped cleanly.

The first candidate trial reused the failed baseline fixture and failed one
unique-email constraint (241/242 passing). The clean-cluster repeat removes
that fixture artifact and is the valid full-suite result. Existing test cleanup
is not robust after failures; this was not hidden by broad shared-DB deletion.

## Release restriction

Do not deploy application-only as a complete fix. An older deployed DB can
currently accept 23% and reject new 15% proposals. Updated DB tests likewise
require the candidate in the canonical migration chain.

Before publication/deployment: verify the actual deployed migration ledger and
function definitions, reconcile the competing PR23 numbering/timestamps without
rewriting history, choose the next unused migration/journal timestamp, confirm
restoration procedures, register the candidate, and run the exact committed
chain plus required application/CI/deployment gates. Production history and
restoration remain unverified. The validation pass did not push, merge, deploy or apply production migrations.
The subsequent draft PR preserves this candidate for review only; publication
does not establish release readiness. A preview, if created by the existing
Vercel integration, must not be used for real transactions against an unverified database.

The application and test changes are the accompanying PR diff. The SQL is
stored outside the migration runner at
`docs/release/candidates/commission-15-plan-line-contract.sql`.
See `docs/runbooks/commission-15-rollout.md` before any release.
