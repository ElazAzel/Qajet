# QAJET — project context for Claude

@agents.md

Durable orientation only. This file does not restate the rules; it points at the
documents that own them. Read the pointed-to file before acting in its area.

## What QAJET is

An **external procurement department for business** — repeatable B2B purchasing
(merch, corporate kits, print) for HR and marketing teams.

QAJET is the **seller/contractor to the buyer**, not a marketplace and not a
payment intermediary. The buyer pays QAJET against QAJET's own obligation; QAJET
settles with suppliers separately. Money never moves "through" the platform.

The product value is not AI. It is that **the same quality of execution takes
fewer human minutes, and the product measures that**. Per-stage time tracking is
a core feature, not analytics decoration.

The domain is complex; the product must feel simple. Each role has one question
the screen must answer: *what happens now, whose turn is it, what do I do, by
when, and what comes next?*

## Repository map

| Path | Role |
| --- | --- |
| `apps/web` | **The live production application.** Next.js App Router. Default target for all work. |
| `apps/mobile`, `apps/desktop` | Capacitor / Tauri shells. Not in the normal web build. |
| `packages/db` | Drizzle schema, migrations, RLS policies, PostgreSQL-backed tests. |
| `packages/engine` | Deterministic TypeScript: estimate, match, combine, leadtime, tax. No external calls. |
| `packages/pd` | The personal-data boundary. Preserve it. |
| `packages/ui` | Shared shells and design tokens. |
| `tools/rag` | Corpus indexer and the generator for `docs/state/`. |

## Source of truth

Defined in **[agents.md](./agents.md)** — read it before non-trivial work. In short:
enforced migrations/tests/code first, then ADRs in `docs/decisions/`, then the full
[product specification](./docs/product/qajet-master-spec.md), then approved plans,
then generated `docs/state/` (regenerate, never hand-edit).

Migrations and comments cite `agents.md §N`. Those section numbers refer to
`docs/product/qajet-master-spec.md`, where the specification now lives. Applied
migrations are never rewritten to fix a citation.

When evidence conflicts, record the conflict and prefer a reproducible test over a
documentation claim.

## Evidence discipline

These four are different things. Never let one imply another:

```
FILE EXISTS  →  IMPLEMENTATION PRESENT  →  VERIFIED  →  PRODUCTION OPERATIONAL
```

A route or file existing is `IMPLEMENTATION PRESENT` and nothing stronger.

Status vocabulary (full definitions in `agents.md` → Release semantics):
`PASS` · `FAIL` · `NOT RUN` · `CONFIRMED` · `REPRODUCED` · `NOT REPRODUCED` ·
`EXTERNAL BLOCKER` · `ASSUMPTION`

**Never turn `NOT RUN` into `PASS`.** Local tests never prove provider, CI,
deployment or production behavior. Recorded evidence lives in `docs/qa/baseline.md`
and `docs/release/readiness.json`.

## Invariants that must not be relearned

Full text in `agents.md` (Security and data invariants / Privileged access). The
ones most often broken by well-meaning changes:

- Authorization is enforced in **both** application code and PostgreSQL RLS/RPC.
  Never derive user, company, role, approval limit or admin access from client
  input or editable metadata.
- **Supplier A must never see Supplier B's** RFQ, quote, plan line, thread,
  document or prices on the same request.
- Approval limits, plan versioning, commission bounds, settlement and lifecycle
  transitions are **database invariants, not UI hints**.
- Use the canonical transition RPC. Broad `UPDATE orders SET state` is prohibited.
- Approved plans and financial facts are immutable outside audited superseding.
- Migrations are **additive**, take the next free number, and update the Drizzle
  journal. Never rewrite a migration already applied to production.
- Every `SECURITY DEFINER` function needs a purpose, restrictive grants, a
  hardened `search_path`, and a PostgreSQL-backed authorization test.
- `service_role` is a server capability, never a browser role.
- Return safe codes and opaque support IDs. **Never surface raw database or
  provider errors** to a user.
- Mail, logging, analytics and scheduled jobs must never corrupt or block the
  core procurement transaction.

## Commands

Full list and caveats in `agents.md` → Scope and commands.

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @qajet/web build
pnpm e2e                          # build + Playwright, web-only
pnpm --filter @qajet/db test:rls  # needs DATABASE_URL
pnpm rag:check                    # is generated state stale?
pnpm rag:sync                     # regenerate docs/state/ (explicit action)
```

Two traps worth repeating:

- `pnpm test` **silently skips** the RLS suite when `DATABASE_URL` is unset. A
  green `pnpm test` without a database says nothing about RLS.
- `pnpm e2e` refuses a non-local Supabase unless `E2E_ALLOW_REMOTE=1` names a
  dedicated test environment. Start the local stack with `supabase start` and
  `pnpm dev:local-env`.

## Environment safety

**Never write to production.** No production database mutation, no schema change,
no secret set/rotate/print, no deploy, no push, no merge, no connector permission
change — without explicit human authorization for that specific action.

Migrations and RLS suites run only against an explicitly named local or test
database. Destructive browser scenarios run only against local Supabase.

Secret **names** are not secret; secret **values** never appear in output, logs,
commits or telemetry. When production configuration is missing, write instructions
for the human owner rather than supplying a value.

Test data is synthetic, namespaced `E2E-<run-id>-<test-name>`, and cleanup touches
only its own namespace. Never broadly reset a shared environment.

## Working discipline

For any behavior change: reproduce it, write a **failing** test, confirm RED, make
the smallest safe fix, confirm GREEN, then run the relevant and broader suites. A
test written after the fix is not TDD.

Preserve unrelated working-tree changes. Run `git diff --check` and scan staged
changes for secrets before handoff. Keep code, migration and docs scope
intentional — no opportunistic refactoring.

Prefer fewer working choices over more technically available ones. Do not add a
capability before proving the existing ones work and are understood.

## Deeper documents

| Need | File |
| --- | --- |
| Operational rules, full invariants | `agents.md` |
| Domain, roles, pricing, lifecycle, design | `docs/product/qajet-master-spec.md` |
| Architecture decisions | `docs/decisions/` |
| Recorded QA evidence and its limits | `docs/qa/baseline.md` |
| Release gate state | `docs/release/readiness.json` |
| Runbooks | `docs/runbooks/` |
| Generated inventory (never hand-edit) | `docs/state/` |
