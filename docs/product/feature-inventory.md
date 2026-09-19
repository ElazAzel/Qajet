# Feature inventory (static baseline)

`CONFIRMED` below means the named source route/module exists. It does not prove
that a provider, database, or user workflow works at runtime.

| Capability | State | Primary surfaces | Important contract |
| --- | --- | --- | --- |
| Authentication and recovery | `CONFIRMED` | `login`, `auth/confirm`, `auth/recover`, `auth/set-password` | Session identity is resolved server-side. |
| Buyer intake | `CONFIRMED` | `buyer/requests/new`, intake actions | Validation and repeat-submission safety need Task 3 proof. |
| Procurement/order review | `CONFIRMED` | `buyer/orders/[id]`, confirm and changes routes | A plan version, approval limit, and lifecycle state must remain authoritative in DB/RPC. |
| Supplier RFQ and quote response | `CONFIRMED` | `supplier/rfq/[id]`, `rfq/respond/[token]` | A supplier must never read another supplier's RFQ, quote, plan line, or thread. |
| Concierge workflow | `CONFIRMED` | `concierge/**`, order item/quote/message screens | Staff actions require actor, company, and lifecycle validation. |
| Admin operations | `CONFIRMED` | `admin/**`, jobs/outbox endpoints | Admin-only access is not permission to expose secrets or telemetry payloads. |
| Documents and attachments | `CONFIRMED` | download route handlers, Storage/attachments migrations | Object access must be proven against an authenticated cross-tenant user. |
| Financial close | `CONFIRMED` | payment facts, payouts, settlement engine/migrations | Plans, payouts, and settlement facts are immutable/audited after approval. |
| Learning and metrics | `CONFIRMED` | `metrics`, `admin/learning`, learning events | Metrics may use privileged access only behind narrow server authorization. |
| Demo and public site | `CONFIRMED` | `/`, `/demo`, `/startupbattle` | Public routes do not prove deployment or production content. |
| Desktop/mobile projects | `CONFIRMED` | `apps/desktop`, `apps/mobile` | Preserved but outside the default web release gate proposed in Task 8. |

## Deferred evidence matrix

| Evidence class | State | Owner |
| --- | --- | --- |
| Buyer-to-close browser journey | `NOT RUN` | Task 5 |
| Real Postgres/RLS contracts | `NOT RUN` | Task 2 |
| Безопасное сообщение об ошибке + supportId | `NOT RUN` | этап 1, G14 |
| CI target commit | `NOT RUN` | Task 8 |
| Deployment/provider/production behavior | `NOT RUN` | Outside this branch unless separately authorized |

