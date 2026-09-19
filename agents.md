# QAJET operational instructions

This concise file is the entry point for contributors and agents. The complete
product specification is [qajet-master-spec.md](./docs/product/qajet-master-spec.md);
it is authoritative for domain behavior, roles, pricing, lifecycle, and design.
Do not duplicate or silently override it here.

Until 2026-09-19 the full specification lived in this file, so comments and
migrations cite it as `agents.md §N`. Those section numbers refer to
`docs/product/qajet-master-spec.md`; applied migrations are never rewritten.

## Source hierarchy

1. Enforced database migrations, tests, and current application code.
2. Current ADRs in `docs/decisions/`.
3. The full [product specification](./docs/product/qajet-master-spec.md).
4. Approved specs and plans under `docs/superpowers/`.
5. Generated `docs/state/` (regenerate; do not hand edit).
6. README and journals, which are narrative and may require revalidation.

When evidence conflicts, record the conflict and prefer a reproducible test over
a documentation claim. Use only `CONFIRMED`, `REPRODUCED`, `NOT REPRODUCED`,
`NOT RUN`, and `ASSUMPTION`.

## Scope and commands

- Install: `pnpm install`.
- Lint: `pnpm lint`.
- Typecheck: `pnpm typecheck`.
- Unit tests: `pnpm test`.
- Web build: `pnpm --filter @qajet/web build`.
- Web E2E: `pnpm --filter @qajet/web e2e` only with an authorized
  non-production test environment.
- Migrations: `pnpm --filter @qajet/db db:migrate` only against an explicitly
  named local/test database.
- RLS contracts: `pnpm --filter @qajet/db test:rls` only against an explicitly
  named local/test database.
- Generated state: `pnpm rag:sync`, then review and commit resulting
  `docs/state/` changes when appropriate.

Local tests never prove provider, deployment, CI, or production behavior. See
`docs/qa/baseline.md` for recorded evidence and limits.

## Security and data invariants

- Enforce authorization in application code and PostgreSQL/RLS/RPC.
- Never derive user, company, role, approval limit, or admin access from client
  input or editable metadata.
- Supplier A must never read Supplier B's RFQ, quote, plan line, thread,
  document, or price data for the same request/order.
- Buyer approval limits, plan versioning, commission bounds, payout/settlement,
  and lifecycle transitions are database invariants, not UI hints.
- Use the canonical transition/RPC path; broad direct `UPDATE orders SET state`
  paths are prohibited.
- Approved plans and financial facts are immutable except for explicit, audited
  superseding/reconciliation workflows.
- Migrations are additive, use the next free number, and update the matching
  Drizzle journal entry.
- Retain audit actors/timestamps on access revocation; never rewrite history.

## Privileged access

- Keep `SUPABASE_SERVICE_ROLE_KEY`, database URLs, signed-link/cron secrets,
  tokens, cookies, and provider errors in environment variables only.
- `service_role` is server/worker capability, never a browser role. Keep
  privileged clients server-only and authorize the narrow operation first.
- Every `SECURITY DEFINER` function needs purpose, restrictive grants, hardened
  `search_path`, and a PostgreSQL-backed authorization test.
- Return stable safe codes/messages and optional opaque support IDs; never raw
  database/provider errors.

## Data and observability

- Request text, messages, emails, addresses, document content/URLs, RFQ tokens,
  quote bodies, and price-line payloads are confidential or personal.
- Preserve `packages/pd` as the personal-data boundary.
- Telemetry is fail-open and may include only allowlisted opaque IDs, operation,
  safe status/code, duration, and bounded counts.
- Telemetry must never include personal/confidential payloads, tokens, cookies,
  SQL, document URLs/content, or raw errors.

## Test data and cleanup

- Use synthetic data only; never target production.
- New E2E/database fixtures use `E2E-<run-id>-<test-name>`.
- Cleanup selects only its owned namespace, identities, and records.
- Do not broadly delete/reset a shared environment, mutate credentials, or
  change providers/deployments without explicit authorization.
- For behavior changes, write a focused failing test first, then implement the
  smallest safe change and run the relevant suite.

## Release semantics

- `PASS` is a named command/scenario that completed for the exact commit.
- `FAIL` is an executed command/scenario that failed.
- `NOT RUN` is no proof and blocks any required release gate.
- `CONFIRMED` source inspection is not runtime evidence.
- `REPRODUCED` and `NOT REPRODUCED` require executed scenarios.
- Never infer CI, browser, database, provider, deployment, or production
  evidence from lint, build, mocks, or local demo data.

## Change discipline

- Preserve unrelated working-tree changes and keep code/migration/docs scope
  intentional.
- Run `git diff --check` and inspect staged changes for secrets before handoff.
- Do not merge, deploy, push, purchase, rotate credentials, or change connector
  permissions unless expressly authorized.
- Document decisions and limitations honestly; a required external gate remains
  `NOT RUN` until actually executed.
