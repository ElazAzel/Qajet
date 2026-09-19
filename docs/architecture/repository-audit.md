# Repository audit and privileged-path inventory

## Structure

| Area | State | Responsibility |
| --- | --- | --- |
| `apps/web` | `CONFIRMED` | Next.js App Router UI, route handlers, Server Actions. |
| `packages/db` | `CONFIRMED` | Drizzle schema, SQL migrations, RLS/RPC contracts, seed/test utilities. |
| `packages/engine` | `CONFIRMED` | Deterministic procurement, financial, and lifecycle logic. |
| `packages/pd` | `CONFIRMED` | Personal-data access/masking abstraction. |
| `packages/ui` | `CONFIRMED` | Shared UI and motion primitives. |
| `apps/{mobile,desktop}` | `CONFIRMED` | Retained non-default clients. |
| `.github/workflows` | `CONFIRMED` | Node 22 lint/typecheck/test/build, conditional live E2E, public smoke, Postgres RLS, and RAG freshness jobs. |

## `service_role` paths

| Location / symbol | State | Purpose | Risk / guard required |
| --- | --- | --- | --- |
| `apps/web/lib/supabase/admin.ts:createSupabaseAdminClient` | `CONFIRMED` | Owner-only invitation flow. | Bypasses RLS; server-only import, owner authorization, no client import, safe error mapping. |
| `apps/web/app/metrics/_jury-access.ts:createJuryMetricsClient` | `CONFIRMED` | Read metrics after a signed jury token is checked. | Bypasses RLS; token must be verified before client creation and scope must stay metrics-only. |
| `packages/db/src/seed/run.ts` | `CONFIRMED` | Create/reset demo Auth users during controlled seeding. | Destructive privileged setup; never run against unknown data; validate all required env before reset. |
| `0000_noisy_tiger_shark.sql` service-role policies | `CONFIRMED` | Full migration/seed/service administration of core domain tables. | The role is all-powerful by design; no browser or public code may obtain its key. |
| `0022_supplier_delivery_and_audit.sql`, `0025_wandering_wither.sql`, `0028_young_toxin.sql`, `0029_nervous_retro_girl.sql`, `0031_outbox_storage_threads.sql`, `0033_thin_cassandra_nova.sql`, `0037_tan_tarantula.sql` service-role policies/grants | `CONFIRMED` | Service administration, worker queues, attachment/payment/thread/learning support. | Worker-only functions must reject non-service roles and use restrictive grants. |
| `0031_outbox_storage_threads.sql:{claim,complete,fail}_outbox` | `CONFIRMED` | Background outbox worker operations. | Queue mutation or data disclosure if callable by authenticated users. |
| `0033_thin_cassandra_nova.sql:{claim,complete,fail}_learning_event` | `CONFIRMED` | Background learning worker operations. | Same worker-only grant and payload-minimization risk. |

## `SECURITY DEFINER` inventory

All entries are `CONFIRMED` as SQL text. They are **not** `REPRODUCED` as
installed database behavior. Earlier migrations can be superseded; Task 2 must
inspect final installed definitions, grants, and `search_path`.

| Migration / symbols | Purpose | Risk |
| --- | --- | --- |
| `0000:492 current_company_id; 501 current_role`; `0008:14/23` replacements | Resolve current identity for RLS. | Identity spoofing or recursive policy escape if claims/path are unsafe. |
| `0003:4 rfq_request_ids_for_current_supplier; 13 buyer_company_ids_for_current_supplier`; `0035:280/292` replacements | Supplier visibility helpers. | Cross-supplier or buyer data leakage. |
| `0013:15 approve_plan`; `0019:18`; `0020:168`; `0022:328`; `0028:295`; `0031:321`; `0033:189` replacements | Approved plan transaction. | Financial/approval bypass; must validate actor and current version. |
| `0016:21 set_team_member_access`; `0026:14` replacement | Team access changes. | Privilege escalation or history corruption. |
| `0020:106 guard_order_actor; 204 guard_request_item_stage`; `0022:110`; `0023:34`; `0026:771/911` replacements | Trigger guards for actor and mutable-stage rules. | Definer trigger can block valid writes or permit unauthorized writes. |
| `0021:4 guard_plan_line_commission; 27 aggregate_plan_commission; 39 guard_approved_plan`; `0039:529/616/658` replacements | Commission and plan aggregate integrity. | Price/commission mutation after approval. |
| `0022:79 audit_order_stage_transition`; `0023:7`; `0033:147`; `0038:61` replacements | Transactional stage audit. | Forged/missing audit facts or recursive trigger failure. |
| `0022:461 get_rfq_quick_response; 513 quick_respond_rfq_public; 539 decline_rfq_public; 563 submit_rfq_public`; `0026:102/145/170/193` replacements; `0039:318 submit_rfq_public` | Token-based public RFQ response. | Token scope/replay can disclose or mutate supplier RFQs. |
| `0023:213 confirm_supplier_delivery` | Supplier delivery confirmation. | Unassigned supplier may advance another order. |
| `0024:12 refresh_supplier_stats; 96/108/127 after-RFQ/quote/rating; 167 get_buyer_rating_targets; 220 submit_supplier_rating` | Derived supplier metrics and buyer rating. | Aggregation manipulation or cross-tenant rating exposure. |
| `0026:580 sync_closed_request_status` | Synchronize request status when an order closes. | Hidden lifecycle write outside canonical transition. |
| `0028:47 guard_payment_fact; 79 guard_plan_reconciliation; 184 guard_paid_obligation; 232 guard_order_financial_facts`; `0032:13 guard_payment_idempotency`; `0039:10 guard_payment_fact_immutability; 57 guard_supplier_payout_total; 725 guard_supplier_payout_summary; 777 guard_prepaid_payment_contract` | Payment, reconciliation, payout, and prepay integrity. | Financial facts can be forged, duplicated, or made inconsistent. |
| `0029:89 ensure_request_threads; 99 ensure_order_threads; 109 ensure_rfq_thread`; `0031:52 ensure_plan_line_supplier_thread`; `0035:308/329/355` replacements | Create required conversation threads. | Unauthorized thread creation or accidental supplier cross-linking. |
| `0031:77 claim_outbox_batch; 115 complete_outbox; 138 fail_outbox` | Worker outbox ownership. | Queue theft, retry abuse, payload exposure. |
| `0033:23 enqueue_order_learning_event; 52 claim_learning_events; 89 complete_learning_event; 114 fail_learning_event`; `0039:820` replacement | Learning event enqueue/worker lifecycle. | Event spoofing or payload exposure. |
| `0035:6/162 supplier_can_access_rfq; 39/199 supplier_can_access_order; 85/249 supplier_can_access_plan_line` | Canonical supplier access predicates. | Any divergence leaks supplier data. |
| `0035:382 assign_supplier_response_user; 421 assign_supplier_rfq` | Assign a supplier user to response/RFQ. | Assignment takeover or unauthorized RFQ access. |
| `0037:292 request_supplier_quote_revision`; `0039:111` replacement | Staff-requested quote revision. | Revision can mutate an invalid/foreign quote. |
| `0037:322 submit_supplier_quote`; `0039:177` replacement | Supplier quote submission. | Repeated/malformed submission or cross-RFQ mutation. |
| `0037:444 guard_time_entry_total` | Time entry aggregate guard. | Incorrect labor metric or write denial. |
| `0037:666 select_order_plan` | Select plan for order. | Plan/version/tenant mismatch. |
| `0038:11 enforce_order_transition; 149 guard_concierge_assignment; 183 assign_order_concierge` | Lifecycle and concierge assignment. | Direct state writes or unauthorized staff assignment. |

## Result

The privileged surface is substantial. `CONFIRMED` source presence is not a
security verdict. The next database-backed task owns the negative tests and
final grants/search-path audit.

