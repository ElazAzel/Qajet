# Static UX audit: recovery starting point

**Method:** route and source inventory only. Every behavioral statement below is
`CONFIRMED` as source presence, not `REPRODUCED` as a user journey.

## Active role surfaces

| Surface | State | Static evidence | Recovery direction |
| --- | --- | --- | --- |
| Buyer intake | `CONFIRMED` | `apps/web/app/buyer/requests/new/page.tsx` | Start empty; make text/manual choice explicit; redirect success to the procurement case. |
| Buyer order detail/change/confirm | `CONFIRMED` | `buyer/orders/[id]`, `changes`, `confirm` routes | Replace order-centric navigation with an action-first procurement case. |
| Supplier dashboard/RFQ/order | `CONFIRMED` | `supplier/**` and `rfq/respond/[token]` routes | Preserve supplier isolation and make assigned delivery state explicit. |
| Concierge queue/order workspace | `CONFIRMED` | `concierge/**` routes | Keep staff workflow while presenting a stable buyer-facing case. |
| Admin | `CONFIRMED` | `admin/{companies,disputes,finance,learning,outbox,settings}` | Add a separately authorized trace explorer; never show trace payloads by default. |
| Public/demo/auth | `CONFIRMED` | root, `demo`, `login`, `auth/**`, document download routes | Do not infer public access from route existence; test every access boundary. |

## Findings and hypotheses

| ID | State | Static finding / hypothesis | Planned proof or recovery |
| --- | --- | --- | --- |
| H1 | `ASSUMPTION` | Storage-object access may be widened by the attachment policy's linked-row lookup. | Task 2 runs an authenticated cross-tenant negative Storage/RLS test. |
| H2 | `ASSUMPTION` | Supplier delivery authorization may not use the canonical supplier-order predicate. | Task 2 compares direct RPC behavior for assigned and unassigned supplier users. |
| H3 | `ASSUMPTION` | A direct `orders.state` write may bypass the intended transition path. | Task 2 attempts it under authenticated Postgres roles. |
| H4 | `ASSUMPTION` | Concurrent plan-change requests may create duplicate pending changes. | Task 2 proves or rejects with a concurrent DB contract test. |
| H5 | `CONFIRMED` | The current intake success target is order-shaped (`buyer/orders/[id]`) rather than a derived procurement case. | Task 4 creates case routes and compatibility redirects. |
| H6 | `ASSUMPTION` | Repeated submissions may make duplicate requests because no client submission key is yet documented as a database invariant. | Task 3 adds and tests idempotency. |
| H7 | `CONFIRMED` | Buyer navigation currently separates request and order concepts across multiple routes. | Task 4 reduces it to a procurement-first information architecture. |
| H8 | `ASSUMPTION` | Existing E2E can depend on retained data or timing because cleanup/namespacing is not a global contract. | Task 5 introduces owned `E2E-<run-id>-<test-name>` records and state-based waits. |
| H9 | `ASSUMPTION` | Future tracing could leak request text, messages, emails, tokens, documents, or quote payloads unless allowlisted. | Task 6 makes PII exclusion a telemetry contract. |
| H10 | `CONFIRMED` | Root default scripts call `turbo run` across the monorepo, while the recovery target is a web-first default gate. | Task 8 changes defaults and retains explicit `*:all` commands. |

## Accessibility and interaction audit status

- `NOT RUN`: keyboard traversal, focus-on-invalid-field, reduced-motion behavior,
  mobile viewport layout, and axe checks.
- `ASSUMPTION`: a server-action error can be made field-specific without exposing
  a raw provider/database error; Task 3 defines the safe result contract first.
- `ASSUMPTION`: a post-intake navigation is reliable only after a server-confirmed
  case state, not an optimistic URL change; Task 4 owns that proof.

