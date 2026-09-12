# QAJET repository finish design

**Date:** 2026-09-12  
**Status:** Approved for implementation by the repository owner  
**Scope:** All repository-controlled gaps from `agents.md` §15, excluding iOS and Android native projects.

## Goal

Make the QAJET repository honest and runnable as a pilot-ready MVP: every state change is authorized and auditable, supplier isolation is enforced in PostgreSQL, supplier delivery is a real user action, the protected RFQ flow works without login, team invitations work when the configured Supabase Auth admin credential is present, and the local/CI verification gates cannot silently pass by skipping their core checks.

## Constraints

- Preserve the fixed stack and versions from `agents.md` §2.
- Keep the main scenario free of LLM and external runtime calls.
- Keep supplier identity and supplier/commission decomposition hidden from buyer-facing data.
- Keep all provider credentials in environment variables; never commit or print them.
- Do not generate iOS or Android native projects.
- Do not claim live Supabase, deployment, Kazakhstan data-center residency, or CI execution from local evidence.

## Decisions

### 1. Audit events are database-owned

An `AFTER UPDATE OF state` trigger on `orders` writes one immutable `order_stage_events` row for every authenticated state transition. Direct authenticated inserts into the audit table are removed. The existing actor guard remains the authorization barrier; the trigger makes state and its audit record one transaction. `approve_plan()` stops inserting a duplicate event and relies on the same trigger.

### 2. Supplier delivery is multi-supplier safe

Add `order_supplier_deliveries`, one immutable confirmation per `(order_id, supplier_company_id)`. A supplier can confirm only an assigned supplier company for an order in `shipped`. The RPC records the confirmation and moves the order to `delivered` only after every supplier in the approved plan has confirmed. The final transition is performed by the confirming supplier and is written to the normal audit log.

### 3. Signed RFQ links use the existing HMAC primitive

Staff-generated links sign `{rfqId, nonce}` with scope `rfq_respond`. The nonce is the existing unguessable RFQ token and is checked again in a database RPC. Anonymous read and write operations use narrowly scoped security-definer RPCs that return only RFQ form data and reject replay after the RFQ is answered. No service-role client is used for the RFQ link.

### 4. Team invitations are an explicit Auth boundary

The owner-only Server Action validates input, creates a manager through Supabase Auth Admin, inserts the matching `public.users` profile, and sends the Auth invite email. The service-role client lives in one server-only module and fails with a clear configuration error when `SUPABASE_SERVICE_ROLE_KEY` is absent. The action is not exposed to supplier or manager sessions.

### 5. Delivery cost follows the actual route

The comparison loader reads both request city and supplier city. Same-city delivery uses the local buffer/cost; different-city delivery uses the intercity buffer/cost. This is implemented as a pure helper with unit tests so seeded and live comparison paths share the same rule.

### 6. E2E setup is platform-neutral and explicit

The standalone asset copy is a Node script using `fs.cpSync`, called by Playwright on Windows and Linux. The E2E suite retains local self-skip when no Supabase environment exists, but CI reports the missing live E2E configuration as a skipped capability in a dedicated preflight rather than pretending the lifecycle was executed. The full lifecycle remains required when the Supabase secrets are configured.

### 7. PII substitution is token-safe

Unmask tokens are replaced longest-first, preventing `EMAIL_1` from corrupting `EMAIL_10`. A regression test covers overlapping token names.

## Definition of done

- `corepack pnpm install --frozen-lockfile`, typecheck, lint, unit tests, build, and Playwright startup pass on Windows.
- No authenticated client can insert an arbitrary order-stage event.
- A direct illegal order transition is rejected by PostgreSQL.
- Supplier A cannot read or mutate supplier B data; supplier delivery is ownership-checked.
- Single- and multi-supplier delivery confirmation works and is auditable.
- RFQ quick-response link supports protected read, accept/quote, decline, expiry, and replay rejection.
- Buyer owner can invite a manager and the profile uses the requested limit and permissions baseline.
- Buyer-facing event history does not reveal supplier personnel identity.
- Logistics and PII regressions have automated tests.
- README/ledger accurately distinguish verified code from infrastructure gates.
- iOS and Android remain explicitly out of scope.
