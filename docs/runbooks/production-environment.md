# Production environment — owner setup

One-time configuration that only a human with account access can perform.
Ongoing operations live in [operations.md](./operations.md).

**Status on 2026-09-20:** production is deployed and healthy but **not ready**.
Three variables are missing. Nothing below can be done by an agent: an agent must
never generate, set, rotate or print a secret value.

Secret **names** are not secret. Secret **values** must never appear in a commit,
a log, a chat message, a screenshot or a ticket.

---

## Where things live

| Thing | Identifier |
| --- | --- |
| Vercel project | `qajet` (team `elazazels-projects`) |
| Supabase project | `qajet`, ref `eoqcktgvnzayyinulbch`, region `ap-southeast-1` |
| Production URL | `https://qajet-seven.vercel.app` |
| GitHub repository | `ElazAzel/Qajet` |

Currently set in Vercel production: `NEXT_PUBLIC_SITE_URL`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`LINK_SIGNING_SECRET`. Nothing is hidden from the listing.

Currently set in GitHub Actions: **nothing**. Zero secrets, zero variables.

---

## 1. `SUPABASE_SERVICE_ROLE_KEY` — unblocks `/api/ready`

This is the single reason `/api/ready` returns 503.
`apps/web/app/api/ready/route.ts` requires exactly three variables; the other two
are already present and the database is `ACTIVE_HEALTHY`, so this one alone
should return readiness to 200.

**Get the value:** Supabase dashboard → project `qajet` → *Project Settings* →
*API keys* → the **`service_role`** key. Not the `anon` key.

**Set it:** Vercel → project `qajet` → *Settings* → *Environment Variables* →
Add.

- Name: `SUPABASE_SERVICE_ROLE_KEY`
- Environment: **Production** only
- Sensitive: yes

This key bypasses Row Level Security completely. It belongs only in server
environment variables — never in `NEXT_PUBLIC_*`, never in client code, never in
a preview environment shared more widely than production.

**Redeploy** after adding it. Environment variables are read at build and runtime;
an existing deployment will not pick it up on its own.

---

## 2. `CRON_SECRET` — unblocks the job queue

`.github/workflows/jobs.yml` runs every 15 minutes and exits at its first guard
without this. It has failed on every run since the workflow was added; the most
recent was run `35480533716` at 2026-09-20T01:06:43Z, lasting 7 seconds.

The job endpoints themselves are correct — `/api/jobs/outbox` and
`/api/jobs/learning` both return 401 unauthenticated. The scheduler simply has no
credential to present.

**Generate a value** (do this yourself, in your own terminal):

```bash
openssl rand -hex 32
```

**Set the same value in both places.** If they differ, the bearer token will not
match and the jobs will return 401 instead of running.

- Vercel → project `qajet` → *Settings* → *Environment Variables*
  → name `CRON_SECRET`, environment **Production**, sensitive.
- GitHub → repository `ElazAzel/Qajet` → *Settings* → *Secrets and variables*
  → *Actions* → *New repository secret* → name `CRON_SECRET`.

On rotation, change both together.

---

## 3. `RESEND_API_KEY` — unblocks real mail

**Read section 4 before setting this.** The key is necessary but not sufficient:
there is a code defect that must be fixed alongside it.

**Get the value:** Resend dashboard → *API Keys*. The sending domain must be
verified, or Resend will reject the send.

**Set it:** Vercel → project `qajet` → Production, sensitive.

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL` — optional. Without it the code falls back to
  `QAJET <onboarding@resend.dev>`, which is fine for a smoke test and wrong for a
  pilot.

---

## 4. The mail path has a defect, not just a missing key

`createEmailAdapter()` in `apps/web/app/lib/notifications/email-adapter.ts`:

```ts
return apiKey ? new ResendAdapter(apiKey) : new LocalSinkAdapter();
```

`LocalSinkAdapter.send()` returns `{ providerMessageId: 'local:…',
transport: 'local-sink' }` — a **success**. So with the key absent, the outbox
drains normally and marks every notification sent while nothing is delivered.
`transport` is returned but never persisted or displayed, so `/admin/outbox`
shows a clean queue and no operator can tell.

`operations.md` describes this as expected dev degradation, which it is —
locally. In production it is a silent data lie: a supplier who never received an
RFQ appears, to everyone looking at the system, to have been notified.

Setting `RESEND_API_KEY` hides the defect without fixing it. Production must
refuse to sink silently — either fail closed when the key is absent in a
production environment, or persist `transport` and surface `local-sink` as a
distinct not-delivered state. This is tracked as a code change, TDD, failing
test first.

---

## Verification — in this order

After 1 and 2 are set and the project has redeployed:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://qajet-seven.vercel.app/api/ready
```

Expect `200`. If it is still 503, read the body — it names the missing variable:

```bash
curl -s https://qajet-seven.vercel.app/api/ready
```

Then dispatch the scheduler manually rather than waiting for the next tick:

```bash
gh workflow run "Scheduled jobs"
gh run list --workflow="Scheduled jobs" --limit 1
```

Expect success, with both `outbox: HTTP 200` and `learning: HTTP 200` in the log.
Then let one natural 15-minute tick pass and confirm it also succeeds.

Mail is **not** verified by any of the above. Verifying it means sending one
synthetic RFQ to a controlled test recipient and confirming the message actually
arrives — enqueue, drained by the scheduler, provider accepted, delivery state
recorded, retry safe, no duplicate. An outbox row reaching `sent` is not evidence
of delivery.

---

## Still external after this

- **Leaked-password protection** is disabled in Supabase Auth
  (advisor `auth_leaked_password_protection`). Dashboard →
  *Authentication* → *Policies*. This is a configuration change, not a migration.
- **Data residency.** Production Supabase is in `ap-southeast-1` (Singapore); the
  specification requires Kazakhstan before real personal data. This needs a
  written decision, not a refactor.
- **Backup and restore.** A backup that has never been restored is not verified.
