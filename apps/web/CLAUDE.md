# apps/web — application rules

@AGENTS.md

The live production application (Next.js App Router). Root `CLAUDE.md` and
`agents.md` still apply; this file adds what is specific to the web app.

## Authorization is server-side

- Resolve actor, company and role **on the server**, from the session. Never from
  a prop, a query parameter, a cookie you wrote, or editable metadata.
- `requireActor(role)` guards a route segment. A layout guard is not enough on its
  own — a server action reached directly must authorize itself.
- The database is the second and authoritative check. A UI that hides a button has
  not prevented anything.
- `createSupabaseAdminClient()` bypasses RLS. Keep it server-only, authorize the
  specific narrow operation immediately before the call, and never widen an
  existing call site casually.

## Server actions return ActionResult

Defined in `app/lib/action-result.ts`:

```ts
{ ok, error?, code?, fieldErrors?, supportId? }
code: 'rejected' | 'invalid' | 'forbidden' | 'conflict'
    | 'not_found' | 'failed' | 'internal'
```

- Build failures with `actionFailure(operation, err, fallback)`. It classifies the
  error, logs it server-side and mints the opaque `supportId`.
- **Never return a raw database or provider error** — no SQLSTATE text, no
  PostgREST body, no provider message, no stack.
- Validation belongs in `fieldErrors`, keyed by field name, so the message renders
  next to the input rather than as a banner.
- The user-facing text is `error`, not `message`; `useAsyncAction` and every client
  component already read that name.
- A failure the user can act on gets a real message. A failure they cannot act on
  gets the generic message plus a `supportId`.

## One obvious action per screen

Each screen answers: *what happens now, whose turn is it, what do I do, by when,
what comes next?*

If five actions have equal visual weight, the screen is wrong. Promote the single
next step; demote the rest. Prefer fewer working choices over more technically
available ones.

Do not redesign the buyer flow — `BuyerCase`, the canonical request URL, the
seven-stage model, submission idempotency, the empty-start form, field-level
errors — without fresh evidence of a regression or a real user problem. That path
was stabilized deliberately.

## Reliability

Assume double-clicks, retries, multiple tabs, interrupted networks and stale
browsers. Correctness comes from database invariants and idempotency keys, not
from disabling a button.

A screen must not require a manual refresh to show the state the user just caused.
Revalidate the affected path. Do not mask staleness with a reload or an arbitrary
timeout.

Mail, logging and analytics are fail-isolated: a provider outage must never break
or roll back the procurement transaction. Equally, a stub or sink must never report
success as though real delivery happened.

## Verification

Prove UI changes in a browser, not by reasoning about JSX.

```bash
pnpm --filter @qajet/web build
pnpm e2e                          # build + Playwright, local Supabase only
```

`pnpm e2e` refuses a non-local Supabase unless `E2E_ALLOW_REMOTE=1` names a
dedicated test environment. Start the stack with `supabase start` and
`pnpm dev:local-env`.

Select by what a human perceives — role, label, visible text, observable state —
never by an internal class name or implementation detail. Do not paper over a
race with retries or reloads; fix the cause.

Check the small viewports (375px) and keyboard-only paths for any screen you
touch. An inaccessible critical action is a functional defect, not a polish item.
