# QAJET repository finish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every repository-controlled QAJET readiness gap from `agents.md` §15 while leaving iOS and Android native projects out of scope.

**Architecture:** Keep TypeScript `transition()` as the application graph, add PostgreSQL guards and an audit trigger as the API boundary, and use narrowly scoped RPCs for anonymous RFQ responses, supplier delivery confirmation, and Auth-backed team invitations. Add pure route calculation and token-safe PII substitution with regression tests; make Playwright startup cross-platform and make CI capability gaps explicit.

**Tech Stack:** Next.js 16.3.4 App Router, TypeScript strict, Supabase Auth/PostgreSQL RLS, Drizzle schema/migrations, Vitest, Playwright, Biome, pnpm 10.33.0.

**Spec:** `docs/superpowers/specs/2026-09-12-qajet-finish-design.md`

## Global Constraints

- No runtime LLM calls; `FEATURE_LLM_ASSIST=false` remains the default.
- Buyer never receives supplier identity or supplier/commission price decomposition.
- Every mutation validates authentication, authorization, ownership, and lifecycle state in the Server Action and PostgreSQL boundary.
- Audit rows are append-only and written in the same database transaction as the state transition.
- Provider credentials remain environment variables and are never printed or committed.
- iOS and Android native projects are excluded.

---

### Task 1: Make standalone Playwright startup cross-platform

**Files:**
- Create: `apps/web/scripts/prepare-standalone.mjs`
- Modify: `apps/web/playwright.config.ts:74-84`
- Test: `apps/web/e2e/public-smoke.spec.ts`

**Interfaces:**
- Produces: `node apps/web/scripts/prepare-standalone.mjs` copies `.next/static` and `public` into `.next/standalone/apps/web` and exits nonzero with a useful message when a source is missing.

- [ ] **Step 1: Write the failing smoke test**

Add a public Playwright test that opens `/` and asserts an accessible heading and the `/login` link. It must run without Supabase credentials.

```ts
import { expect, test } from '@playwright/test';

test('public landing opens from the production standalone server', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: /войти в систему/i })).toBeVisible();
});
```

- [ ] **Step 2: Run the test and verify the known failure**

Run `corepack pnpm --filter @qajet/web e2e`. It must fail before the test with Windows' `'cp' is not recognized` error from `playwright.config.ts`.

- [ ] **Step 3: Implement the Node asset copier**

Use `node:fs` and `node:path` from `process.cwd()`:

```js
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const staticDir = resolve(root, '.next', 'static');
const publicDir = resolve(root, 'public');
const standaloneRoot = resolve(root, '.next', 'standalone', 'apps', 'web');

for (const source of [staticDir, publicDir]) {
  if (!existsSync(source)) throw new Error(`Standalone source is missing: ${source}`);
}

cpSync(staticDir, resolve(standaloneRoot, '.next', 'static'), { recursive: true });
cpSync(publicDir, resolve(standaloneRoot, 'public'), { recursive: true });
```

Replace the shell `cp` chain with `node scripts/prepare-standalone.mjs && node .next/standalone/apps/web/server.js`.

- [ ] **Step 4: Run the smoke test and full E2E configuration**

Run `corepack pnpm --filter @qajet/web build`, then `corepack pnpm --filter @qajet/web e2e`. The public smoke test must pass; only live Supabase specs may be skipped when the environment is absent.

- [ ] **Step 5: Commit**

```bash
git add apps/web/scripts/prepare-standalone.mjs apps/web/playwright.config.ts apps/web/e2e/public-smoke.spec.ts
git commit -m "fix: make standalone e2e startup cross-platform"
```

---

### Task 2: Close PII and route-calculation regressions

**Files:**
- Modify: `packages/pd/src/mask.ts:99-105`
- Test: `packages/pd/src/__tests__/mask.test.ts`
- Create: `apps/web/app/lib/delivery-route.ts`
- Modify: `apps/web/app/lib/comparison.ts:59-149`
- Test: `apps/web/app/lib/delivery-route.test.ts`

**Interfaces:**
- Produces: `deliveryRoute(supplierCity: string | null, requestCity: string | null): { bufferDays: number; deliveryKzt: number; kind: 'local' | 'intercity' }`.

- [ ] **Step 1: Add the failing PII regression test**

Add a test that passes `{ EMAIL_1: 'short@example.kz', EMAIL_10: 'long@example.kz' }` to `unmaskPII` and expects both tokens to be restored independently.

- [ ] **Step 2: Run the PII test and verify it fails**

Run `corepack pnpm --filter @qajet/pd exec vitest run src/__tests__/mask.test.ts`. The current insertion-order replacement must produce a corrupted `EMAIL_10` result.

- [ ] **Step 3: Implement longest-first unmasking**

Replace `Object.entries(unmaskMap)` iteration with:

```ts
for (const [token, value] of Object.entries(unmaskMap).sort(([left], [right]) => right.length - left.length)) {
  result = result.replaceAll(token, value);
}
```

- [ ] **Step 4: Verify the PII fix**

Run the focused test again and then `corepack pnpm --filter @qajet/pd test`.

- [ ] **Step 5: Add the failing delivery-route tests**

Cover same-city local routing, different-city intercity routing, and null/blank cities defaulting to intercity:

```ts
expect(deliveryRoute('Алматы', 'Алматы')).toEqual({ kind: 'local', bufferDays: 1, deliveryKzt: 5_000 });
expect(deliveryRoute('Караганда', 'Алматы')).toEqual({ kind: 'intercity', bufferDays: 3, deliveryKzt: 15_000 });
```

- [ ] **Step 6: Implement and connect the pure route helper**

Normalize trimmed city values, return local only for equal nonempty cities, and use the existing 1/3-day and 5,000/15,000 ₸ constants. Select `city` in the request query and pass the request city plus supplier city from `comparison.ts`.

- [ ] **Step 7: Verify route behavior**

Run `corepack pnpm --filter @qajet/web exec vitest run app/lib/delivery-route.test.ts` and `corepack pnpm --filter @qajet/web test`.

- [ ] **Step 8: Commit**

```bash
git add packages/pd/src/mask.ts packages/pd/src/__tests__/mask.test.ts apps/web/app/lib/delivery-route.ts apps/web/app/lib/delivery-route.test.ts apps/web/app/lib/comparison.ts
git commit -m "fix: harden pii restoration and delivery routing"
```

---

### Task 3: Make order history immutable and supplier delivery authoritative

**Files:**
- Modify: `packages/db/src/schema/procurement.ts` (supplier confirmations, order policies, event policies)
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/migrations/0022_supplier_delivery_and_audit.sql`
- Modify: `packages/db/migrations/meta/_journal.json`
- Modify: `packages/engine/src/order/transition.ts`
- Modify: `packages/engine/src/order/transition.test.ts`
- Modify: `apps/web/app/lib/actions/order-actions.ts`
- Modify: `apps/web/app/lib/actions/supplier-actions.ts`
- Create: `apps/web/app/supplier/orders/[id]/page.tsx`
- Create: `apps/web/app/supplier/orders/[id]/_delivery-confirmation.tsx`
- Modify: `apps/web/app/lib/supplier-home.ts`
- Modify: `apps/web/app/supplier/page.tsx`
- Test: `packages/db/src/__tests__/platform-integrity.test.ts`
- Test: `packages/db/src/__tests__/supplier-delivery.test.ts`

**Interfaces:**
- Produces: `confirm_supplier_delivery(p_order_id uuid) returns boolean`; `confirmSupplierDelivery(orderId: string): Promise<ActionResult>`; `nextStatesFor('shipped', 'supplier')` returns `['delivered']`.

- [ ] **Step 1: Add failing engine tests**

Assert supplier delivery is allowed, supplier cannot approve/accept, and disputed orders cannot jump back to `on_hold`.

- [ ] **Step 2: Run the engine tests and verify failure**

Run `corepack pnpm --filter @qajet/engine exec vitest run src/order/transition.test.ts` and confirm the supplier delivery expectation fails against the current staff-only graph.

- [ ] **Step 3: Add schema and SQL failing integration assertions**

Add real-Postgres tests for: authenticated staff cannot insert a fabricated event; supplier A cannot confirm supplier B's order; a multi-supplier order remains `shipped` until all assigned suppliers confirm; the final confirmation sets `delivered` and writes exactly one event.

- [ ] **Step 4: Implement the engine graph and Drizzle schema**

Add supplier to the `shipped -> delivered` edge. Add `orderSupplierDeliveries` with foreign keys, unique `(orderId, supplierCompanyId)`, supplier insert policy, own-company select policy, staff select policy, and service-role policy.

- [ ] **Step 5: Implement migration 0022**

Create the table, indexes, RLS policies, `guard_supplier_delivery`, `confirm_supplier_delivery`, and `audit_order_stage_transition`. Drop `order_stage_events_insert_actor`, create the `orders` after-state trigger, and replace `guard_order_actor` with a supplier branch that checks assigned plan lines and all delivery confirmations. Remove the obsolete `disputed -> on_hold` SQL edge. Remove the manual event insert from `approve_plan()`.

- [ ] **Step 6: Route all application stage writes through the authoritative audit path**

Delete `logStageEvent()` calls after order updates; the trigger now records events in the same transaction. Keep prerequisite writes idempotent, and make supplier payout insertion use conflict-safe keys before the guarded `suppliers_paid` update.

- [ ] **Step 7: Implement supplier confirmation UI and action**

The action verifies the current supplier actor, calls the RPC, revalidates `/supplier` and `/supplier/orders/[id]`, and returns whether other suppliers remain. The order page shows the confirmation button only for `shipped` orders assigned to the current company and displays the waiting message for partial confirmation.

- [ ] **Step 8: Run database tests with a real database when configured**

Run `corepack pnpm --filter @qajet/db db:migrate`, `corepack pnpm --filter @qajet/db test:rls`, and `corepack pnpm --filter @qajet/db test`. Without `DATABASE_URL`, record the exact skipped count and do not call RLS verified.

- [ ] **Step 9: Run engine/web tests and commit**

```bash
corepack pnpm --filter @qajet/engine test
corepack pnpm --filter @qajet/web test
git add packages/db packages/engine apps/web/app/lib/actions apps/web/app/supplier
git commit -m "feat: enforce audited supplier delivery transitions"
```

---

### Task 4: Implement protected RFQ response links

**Files:**
- Modify: `apps/web/app/lib/signed-link.ts`
- Modify: `apps/web/app/lib/actions/order-actions.ts`
- Create: `apps/web/app/lib/rfq-response.ts`
- Modify: `apps/web/app/lib/actions/supplier-actions.ts`
- Create: `apps/web/app/rfq/respond/[token]/page.tsx`
- Create: `apps/web/app/rfq/respond/[token]/_public-response.tsx`
- Extend: `packages/db/migrations/0022_supplier_delivery_and_audit.sql`
- Modify: `packages/db/migrations/meta/_journal.json`
- Test: `apps/web/app/lib/rfq-response.test.ts`
- Test: `apps/web/e2e/rfq-quick-response.spec.ts`

**Interfaces:**
- Produces: `createRfqResponseLink(rfqId: string): Promise<string>`; `loadQuickRfq(payload): Promise<QuickRfqData | null>`; `submitQuickRfq(payload, lines): Promise<ActionResult>`; `declineQuickRfq(payload): Promise<ActionResult>`.

- [ ] **Step 1: Add failing signed payload tests**

Test that a signed `rfq_respond` payload carries `{ rfqId, nonce }`, a wrong scope or changed nonce is rejected, and an answered RFQ cannot be submitted again.

- [ ] **Step 2: Run focused tests and verify failure**

Run `corepack pnpm --filter @qajet/web exec vitest run app/lib/rfq-response.test.ts`.

- [ ] **Step 3: Implement signed RFQ payload and database RPCs**

Use the existing HMAC primitive with a short response TTL. Add security-definer read/decline/submit RPCs that validate RFQ token, active supplier company, `sent`/`quick_responded` state, request items, numeric bounds, and one-response replay protection before writing quote lines.

- [ ] **Step 4: Add staff link generation and mobile-first public page**

Generate the link from staff-visible RFQ data and render a minimal response screen with request items, deadline, “Берусь” and “Не берусь”. The full quote form reuses the same numeric validation rules as the authenticated supplier flow.

- [ ] **Step 5: Verify link behavior**

Run focused unit tests, web unit tests, and the E2E spec when Supabase is configured; without it, verify the page returns a controlled unavailable response rather than a 500.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/lib/rfq-response.ts apps/web/app/lib/actions/supplier-actions.ts apps/web/app/rfq/respond packages/db/migrations
git commit -m "feat: add protected supplier rfq response links"
```

---

### Task 5: Add owner team invitations

**Files:**
- Create: `apps/web/lib/supabase/admin.ts`
- Modify: `apps/web/app/lib/actions/team-actions.ts`
- Create: `apps/web/app/buyer/team/_invite-form.tsx`
- Modify: `apps/web/app/buyer/team/page.tsx`
- Modify: `apps/web/app/lib/buyer-team.ts`
- Test: `apps/web/app/lib/actions/team-actions.test.ts`

**Interfaces:**
- Produces: `inviteTeamMember(input: InviteTeamMemberInput): Promise<ActionResult>` where `input` is `{ email: string; fullName: string; approvalLimitKzt: number | null }` and the new profile is always a `manager` in the current owner's company.

- [ ] **Step 1: Add failing validation and authorization tests**

Cover non-owner rejection, invalid email/name/limit rejection, missing service-role configuration, and successful auth/profile creation using a dependency-injected admin client.

- [ ] **Step 2: Run the focused tests and verify failure**

Run `corepack pnpm --filter @qajet/web exec vitest run app/lib/actions/team-actions.test.ts`.

- [ ] **Step 3: Implement the server-only admin boundary**

Create `createSupabaseAdminClient()` with `import 'server-only'`, require both Supabase URL and service-role key, disable session persistence, and never expose the client to a Client Component. The action checks `requireCurrentUser()` and `role === 'owner'`, calls `auth.admin.inviteUserByEmail`, inserts `public.users` with the returned id, and returns a clear error if either step fails.

- [ ] **Step 4: Add the invite form**

Use existing `useAsyncAction`/`Button` patterns, validate before submission, refresh `/buyer/team` on success, and show that the invitation email contains the account activation link.

- [ ] **Step 5: Verify and commit**

Run focused tests, `corepack pnpm --filter @qajet/web typecheck`, and `corepack pnpm --filter @qajet/web test`.

```bash
git add apps/web/lib/supabase/admin.ts apps/web/app/lib/actions/team-actions.ts apps/web/app/lib/actions/team-invitation.ts apps/web/app/buyer/team
git commit -m "feat: invite buyer team members"
```

---

### Task 6: Make CI and documentation reflect real verification

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`
- Modify: `apps/web/app/buyer/settings/page.tsx`
- Modify: `apps/web/app/lib/actions/order-actions.ts` comments
- Modify: `apps/web/app/supplier/layout.tsx`
- Create: `docs/reviews/2026-09-12-repository-audit.md`
- Modify: `docs/state/ledger.md`

**Interfaces:**
- Produces: CI jobs that either execute their intended live checks or visibly report the missing capability; repository documentation matches implemented routes and remaining infrastructure-only gates.

- [ ] **Step 1: Add a CI preflight test script**

Create `tools/ci/check-live-e2e-env.mjs` that exits zero locally, but in CI exits 2 with a GitHub Actions notice when `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` is absent. Wire it as a named preflight so the job is clearly actionable rather than a green all-skipped lifecycle.

- [ ] **Step 2: Add the CI configuration and documentation changes**

Keep unit jobs runnable without secrets, make the live E2E job conditional on both secrets, add the public smoke test to the always-on job, document the RLS/Live E2E prerequisite, remove stale claims that `/buyer/team` or supplier routes do not exist, and retain iOS/Android as excluded.

- [ ] **Step 3: Verify formatting and RAG freshness**

Run `corepack pnpm lint`, `corepack pnpm rag:sync`, and `git diff --check`. Resolve the CSS specificity warning and declare `JWT_SECRET` in `turbo.json` so lint is warning-free.

- [ ] **Step 4: Run the complete local gate**

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
corepack pnpm e2e
```

Record skipped database/live checks separately when Docker or Supabase credentials are unavailable.

- [ ] **Step 5: Commit documentation and CI**

```bash
git add .github/workflows/ci.yml README.md apps/web/app/buyer/settings/page.tsx apps/web/app/lib/actions/order-actions.ts apps/web/app/supplier/layout.tsx tools/ci docs/reviews/2026-09-12-repository-audit.md docs/state/ledger.md
git commit -m "chore: align qajet gates and documentation with reality"
```

---

### Task 7: Final verification and handoff

**Files:**
- Verify: all files from Tasks 1–6

- [ ] **Step 1: Inspect the final diff and status**

Run `git status --short --branch`, `git diff --stat HEAD~6..HEAD`, and `git diff --check`. Confirm no `.env*`, tokens, credentials, iOS, or Android artifacts are tracked.

- [ ] **Step 2: Run fresh verification commands**

Run the complete local gate from Task 6, plus focused engine, PD, web, and DB suites. Use the real Postgres RLS suite only when `DATABASE_URL` exists.

- [ ] **Step 3: Check requirements line by line**

Re-read `agents.md` §15, mark each repository-controlled item as verified or explicitly environment-gated, and compare it with `docs/reviews/2026-09-12-repository-audit.md`.

- [ ] **Step 4: Hand off evidence**

Report exact commands, pass/skip counts, changed files, remaining infrastructure gates, and the fact that iOS/Android were intentionally excluded. Do not claim deployment, live provider checks, or traction without current evidence.
