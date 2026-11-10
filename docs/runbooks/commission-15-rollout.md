# Review and release the 15% commission fix

Status: **DRAFT / NOT READY FOR PRODUCTION**. This document does not authorize
production access, migration execution, merging, or deployment.

The application and database must agree on a 10–15% commission range and a
15% standard rate for new plans. Main migration 0062 updates one guard and the
commission RPC but leaves `guard_plan_line_contract` at 21–24%. Consequently,
new 15% plans cannot be persisted through an authenticated staff session.

## Review artifacts

- [Validation and limitations](../qa/commission-15-review-2026-11-10.md).
- [Additive SQL candidate](../release/candidates/commission-15-plan-line-contract.sql).
- The application and regression tests in the same draft PR.

The SQL is deliberately outside `packages/db/migrations` and is not registered
in the Drizzle journal. Do not run it manually on production or treat its
presence in the repository as a completed migration.

## Before finalizing the migration

An authorized operator must collect read-only evidence from the actual target:

1. Identify the database and deployed application commit. Keep credentials out
   of screenshots, commits and reports. Use only the intended environment.
2. Inspect `drizzle.__drizzle_migrations` hashes and timestamps and compare them
   against the complete canonical main SQL and journal. If history is unknown,
   missing or inconsistent, stop and reconcile it first.
3. Inspect the deployed definitions of `guard_plan_line_contract`,
   `guard_plan_line_commission`, `update_plan_line_commission`, and their
   triggers. Check whether 0062 actually ran; its presence in Git is not proof.
4. Reconcile the competing PR23 migration numbers and timestamps. Preserve
   already-applied migrations. Merely renumbering files while keeping older
   timestamps can cause Drizzle to skip them.
5. Verify a usable backup and a successful restore rehearsal for the intended
   production system. A passing disposable local test is not recovery evidence.

Only after those checks, choose the next unused migration number and a journal
timestamp later than the verified canonical history. Copy the reviewed candidate
into that new migration and register it. Do not rewrite 0039 or 0062, change
existing hashes, or silently mark migrations applied.

## Required validation

Use a dedicated disposable local/test database with synthetic data. Never run
the test suite against production.

1. Apply the exact proposed committed chain with the repository's supported
   migration command. Record the commit, command and result. The earlier psql
   validation proves SQL behavior only; the tsx IPC failure means the official
   Drizzle command remains unverified in that execution environment.
2. Confirm that new plans accept 10%, 12.5% and 15%, reject 21–24%, and show
   correct commission and totals in comparison and persistence.
3. Confirm direct and RPC commission edits recalculate totals atomically,
   reject rates outside the new range, and cannot modify approved plans.
4. Confirm legacy approved amounts and percentages are unchanged. The candidate
   must not rewrite stored rows to 15%.
5. Run required lint, typechecks, unit/database tests, web build and browser E2E
   against the final commit. Clear the known dependency and pre-existing lint
   blockers rather than treating focused checks as a full release pass.

## Authorized rollout only

Do not ship the application change alone to a database that still rejects 15%.
Plan a coordinated release after all checks above. Review any preview's database
destination before testing; an automatic preview is not permission to create
real customer transactions or to use production fixtures.

After an authorized rollout, verify the new ledger entry, effective function
definitions, deployed commit, readiness and relevant pricing/approval flows.
Do not declare the product ready for real clients based solely on this fix.

If a gate fails, stop the rollout and preserve evidence. Do not restore broad
permissions, alter historical approved prices, downgrade migration history, or
use the old incompatible guards as an unreviewed rollback. Agree on recovery
using the verified deployed state and restore procedure.
