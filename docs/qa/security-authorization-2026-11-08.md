# Authorization hardening: 2026-11-08

Status: **NOT READY FOR PRODUCTION**. These changes do not apply migrations to a
hosted database. No production data, credentials or providers were used.
Base: `572e1b9d476ee1d1d920493bbb2f486057c3d201`.

## Scope

- `0059_quote_revision_authorization`: fail closed when `current_role()` is NULL
  in `request_supplier_quote_revision`. Signature, transaction locks, notification
  behavior, search path and grants remain unchanged.
- `0060_owner_invite_isolation`: owner invitation messages contain credentials.
  Restrict their SELECT/INSERT/UPDATE to admin and service workers. Ordinary
  concierge notifications remain usable; UPDATE checks both old and new rows.
- `0061_buyer_document_isolation`: supplier visibility of an order does not grant
  access to its buyer documents. Buyer sees its own non-supplier invoices;
  staff retains internal document access.
- Synchronize the corresponding Drizzle policy definitions. No historical
  migration, client data or queued invitation is rewritten or removed.

## Executed checks

The exact source SHA and command logs are recorded in the accompanying validation
artifact. Use the commit containing this report; do not infer deployed behavior
from a local test or a GitHub/Vercel status.

On disposable PostgreSQL 17.11 with minimal test Auth/Storage interfaces:

- Focused quote revision tests before 0059: **4 FAIL, 8 PASS**, reproducing access
  by inactive concierge/admin/buyer and an Auth identity without a profile.
- Transactional migration rehearsal: function definition, ACL, search path and
  SECURITY DEFINER flag restored exactly on rollback.
- After 0059: privileged RPC suite **61 PASS**.
- Sensitive record tests before 0060/0061: **3 FAIL, 14 PASS**, reproducing invite
  access, invite creation and supplier access to buyer documents.
- DB suite after 0059–0061, excluding `scheduled-jobs.test.ts`: **227 PASS**,
  28 files. Includes worker claim/complete of an admin-created synthetic invite,
  concurrency tests and denial checks with unchanged underlying records.
- Independent review: no blocking findings for these three migrations; reviewer
  separately reproduced the invitation leak before its fix.
- Typecheck and lint succeeded; lint retains one existing optional-chain warning
  in `tools/dev/local-supabase-env.mjs`.

Commands (DATABASE_URL must identify an isolated test DB):

```sh
pnpm --filter @qajet/db db:migrate
pnpm --filter @qajet/db exec vitest run src/__tests__ --exclude '**/scheduled-jobs.test.ts'
pnpm typecheck
pnpm lint
```

## Full Supabase validation limitations

The public `supabase/postgres:17.6.1.167` image was flattened locally to avoid
Docker vfs layer amplification. The single layer contains the upstream files;
rootfs SHA256: `103cc0a854805460e75a27041b61053a046e642f3270069fe940ed7ef06c859b`.
This is test tooling, not a production image publication.

A separate PostgreSQL 17.6 container started successfully with real Vault,
pg_cron and pg_net. All **62 migrations (0000–0061)** applied after adding an
explicitly labelled minimal Storage test facade. This proves SQL application
with these extensions, not compatibility with a running Storage API.

The full DB suite on that incomplete native image returned **108 FAIL / 126
PASS**. Its Auth service had not migrated the image's legacy auth.uid() and
Auth schema (e.g. missing email_confirmed_at). This result is not a passing full
Supabase gate and was not hidden by replacing its Auth implementation.

Supabase CLI 2.117.0 could run after creating its tool settings directory, but
starting the complete isolated stack was blocked downloading Auth, Storage,
PostgREST, Kong, Realtime and Mailpit images: network policy returns **Forbidden
for public.ecr.aws**. Retries were stopped. No alternate registry was used to
circumvent that denial. Allow the domain in the selected environment's network
settings and retry on that environment after its policy is confirmed enforced.

## Remaining launch blockers

- Buyer direct SELECT of full `plans` and full `approve_plan` return values still
  expose internal pricing. Requires an allowlisted projection, caller migration,
  and compatible request_plan_change/approval tests.
- Buyer can supply document metadata. Requires canonical DB-generated snapshots,
  transactional close/document creation and concurrent duplicate protection.
- Complete Auth/Storage/PostgREST and authenticated browser tests remain NOT RUN.
- Production runtime SHA/health, CI for the release, real email delivery, backup
  restoration, operator requisites and personal-data hosting are not established
  by this report.
- Do not apply the new migrations to production or call the release ready until
  the required independent staging and release checks have completed.
