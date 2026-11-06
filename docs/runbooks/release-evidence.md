# Evidence for a client release

`/api/health` proves process availability. `/api/ready` now requires the actual
runtime's Supabase, site, link-signing, cron and Resend configuration, a
`settings.environment_kind = "clients"` marker, and validated operator
requisites. It returns the runtime commit. A 200 still does **not** prove mail
delivery, restore capability, legal approval, RLS, or complete user journeys.
An existing demo deployment intentionally does not pass client readiness.

The strict gate requires a clean Git checkout. Keep release evidence outside
the checkout to avoid a self-referential commit and untracked-file failures:

```sh
node tools/ci/check-release-readiness.mjs --strict \
  --ready-url=https://YOUR-DEDICATED-STAGING-HOST \
  --evidence=/tmp/qajet-release-evidence.json
```

The JSON uses `schemaVersion: 1`, `status: "ready-for-production"`, and
`sourceSha` equal to the checkout's full 40-character SHA. Its `gates` object
must have evidence descriptions starting with `passed-ci:`, `passed-local:`,
`passed-staging:`, or `passed-production:` for each required key:

- `rlsSuite`
- `e2eBuyerJourney`, `e2eOrderLifecycle`, `e2eSupplierJourney`
- `e2eConciergeJourney`, `e2eAdminJourney`, `storageFlow`
- `mailDelivery`, `backupRestore`, `pdResidency`, `clientEnvironment`
- `liveSupabase`, `scheduledJobs`, `authHardening`

`gateSourceShas` must map every required gate to that same release SHA.
Descriptions should reference retained logs/results and the dedicated tested
environment. Do not replace missing evidence with a passed label. The gate
checks the declared contract; a reviewer must verify the underlying evidence.
For an external decision, record the operator's approval and its applicability
to this exact release and infrastructure. Keep passwords, private documents,
customer data, keys and signed URLs out of evidence.

The deployed `/api/ready` must return JSON with `ok: true`,
`dependency: "supabase"` and `commit` equal to that SHA. Redirects, login HTML,
missing/unknown commits and old deployments fail. Vercel supplies
`VERCEL_GIT_COMMIT_SHA`; other runtimes must supply `GIT_COMMIT_SHA`.

GitHub's manual Release gate workflow accepts the same JSON as `evidence_json`,
passes it as data through an environment variable, writes it in `RUNNER_TEMP`,
and checks it without shell interpolation. Configure all declared repository
secrets, including `RESEND_API_KEY` and `RESEND_FROM_EMAIL`. Never paste secrets
into the evidence JSON or dispatch inputs.

The tracked historical `docs/release/readiness.json` remains explicitly not
ready. It is useful for source checks and past evidence; it must not be
relabeled as a production approval for untested changes.
