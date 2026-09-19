# Data classification and handling contract

## Classes

| Class | Examples | Handling |
| --- | --- | --- |
| Public | Marketing copy, public landing content, non-secret route names | May be public; still validate download and token routes individually. |
| Internal operational | Order state, plan totals, RFQ metadata, queue status, supplier performance aggregates | Tenant/staff authorization; no cross-supplier visibility. |
| Confidential business | Request text, item specs, quote bodies/prices, plan composition, negotiations, documents, supplier payout facts | RLS/RPC authorization, minimized server responses, never emit to telemetry. |
| Personal data | Name, email, delivery address, user/company identifiers when linked to a person | Use `packages/pd` boundary; least privilege; never log or trace raw values. |
| Secrets and security material | `SUPABASE_SERVICE_ROLE_KEY`, anon keys where operationally sensitive, database URL, cron secret, signed-link secret, auth cookies, RFQ tokens | Environment only; never source, client bundle, screenshots, traces, or error messages. |

## Non-negotiable observability rule

`CONFIRMED` design contract: traces, logs, support IDs, and metrics may contain
allowlisted opaque IDs, operation name, safe status/code, elapsed time, and
bounded counts. They must not contain request text, message body, email,
address, token, cookie, document URL/content, quote body, price-line payload,
database error text, or provider error text.

## Authorization boundaries

- Buyer company users access their company cases subject to approval limits.
- Suppliers only access RFQs/orders/plan lines/threads permitted by the canonical
  supplier predicates; supplier-to-supplier visibility is prohibited.
- Concierge/admin access is role-checked and remains audited.
- `service_role` is a server/worker capability, never a user role.
- A signed link is a narrow authorization mechanism, not a substitute for a
  general anonymous RLS policy.

## Test-data contract

All new browser/database test records use `E2E-<run-id>-<test-name>`.
Cleanup selects only that namespace and owned identities/records; it must never
bulk-delete production-like data. Test fixtures contain synthetic data only.

