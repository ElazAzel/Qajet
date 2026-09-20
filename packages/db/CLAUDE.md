# packages/db — database rules

@AGENTS.md

Schema, migrations, RLS policies and PostgreSQL-backed tests. Root `CLAUDE.md` and
`agents.md` still apply; this file adds what is specific to the database.

## Migrations are immutable once applied

- **Never edit a migration that has run against production.** Production is at
  `0050`. Correct a mistake with a new, additive migration.
- Take the next free number. Update the matching Drizzle journal entry
  (`migrations/meta/_journal.json`) and snapshot.
- Prefer additive change: add a column, backfill, then constrain. Avoid a
  destructive rewrite of a table that holds live procurement or financial facts.
- A migration that changes privileges must say, in a comment, who may execute what
  and why.

## RLS is the enforcement layer, not a safety net

Application checks are a convenience; the database is the authority. Every policy
change needs a test proving both that the allowed case works **and** that the
denied case fails.

Non-negotiable tenant boundaries:

- Supplier A cannot read Supplier B's RFQ, quote, plan line, thread, attachment or
  prices on the same request or order.
- A buyer cannot read another company's anything, nor supplier-private documents.
- A supplier cannot read buyer payment proof.
- Deactivated staff lose access while their audit actor rows survive.

## SECURITY DEFINER review checklist

Any new or changed `SECURITY DEFINER` function must record all of:

1. Why `SECURITY DEFINER` is required and why `SECURITY INVOKER` will not do.
2. Who may `EXECUTE` — and an explicit `REVOKE` for everyone else.
3. The authorization check performed **inside the body**, before any write.
4. `SET search_path = ''` (empty, not `public`), with every reference schema-qualified.
5. A PostgreSQL-backed test proving an unauthorized caller is rejected.

Current state: all callable `SECURITY DEFINER` functions are `search_path`-pinned.
Four are intentionally executable by `anon` — the token-gated public RFQ endpoints
(`get_rfq_quick_response`, `quick_respond_rfq_public`, `decline_rfq_public`,
`submit_rfq_public`). Each validates token, deadline and active supplier in-body.

**Do not blanket-revoke to silence the Supabase advisor.** An advisor warning is a
finding to investigate, not an automatic defect. Prove the authorization instead.

Note the known blind spot: the `0042` privilege sweep and its regression test both
filter on `prosecdef`, so `SECURITY INVOKER` trigger functions are not swept, and
`0043` grants `EXECUTE` to `authenticated` by default for new functions. A new
trigger function needs an explicit `REVOKE`.

## Transactions and concurrency

- Assume double-clicks, retries, multiple tabs, and interrupted networks. Use
  database invariants — unique keys, guards, `FOR UPDATE` — not UI debouncing.
- Take row locks in a consistent order. Lock the row you are about to change
  before you read the value you will branch on.
- Idempotency belongs to a key stored in the database, not to application memory.
- Keep transactions narrow. Never hold one across an external provider call.

## Testing

TDD against **real PostgreSQL**, never a mock:

```bash
pnpm --filter @qajet/db test:rls   # requires DATABASE_URL
```

`DATABASE_URL` must name an explicitly local or test database. Root `pnpm test`
silently skips this suite when the variable is unset — a green `pnpm test` without
a database proves nothing about RLS.

**Never run migrations or tests against production.**
