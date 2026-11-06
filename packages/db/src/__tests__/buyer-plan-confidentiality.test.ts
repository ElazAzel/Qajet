import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

/**
 * Buyer plan reads must expose a fixed DTO, never the financial backing row.
 * Real PostgreSQL only. Each fixture owns an E2E-UUID namespace and is rolled
 * back, including local outbox/audit rows; no external worker is started.
 */
const databaseUrl = process.env.DATABASE_URL;
const describeIfConfigured = databaseUrl ? describe : describe.skip;
const rollback = new Error('buyer-plan-confidentiality fixture rollback');
const DTO_KEYS = [
  'id',
  'request_id',
  'version',
  'kind',
  'status',
  'delivery_kzt',
  'supplier_rebate_kzt',
  'total_kzt',
  'eta_date',
  'slack_days',
  'supplier_count',
].sort();

interface World {
  namespace: string;
  buyerCompany: string;
  inactiveCompany: string;
  owner: string;
  manager: string;
  otherOwner: string;
  supplier: string;
  staff: string;
  admin: string;
  inactiveBuyer: string;
  inactiveStaff: string;
  inactiveCompanyOwner: string;
  missingProfile: string;
  request: string;
  teammateRequest: string;
  foreignRequest: string;
  order: string;
  plan: string;
  draftPlan: string;
  approvedPlan: string;
  supersededPlan: string;
  teammatePlan: string;
  foreignPlan: string;
}

async function scenario(run: (tx: postgres.TransactionSql, w: World) => Promise<void>) {
  const sql = postgres(databaseUrl as string, { max: 1, prepare: false });
  const id = () => crypto.randomUUID();
  try {
    await sql
      .begin(async (tx) => {
        const w: World = {
          namespace: `E2E-${id()}-buyer-plan-confidentiality`,
          buyerCompany: id(),
          inactiveCompany: id(),
          owner: id(),
          manager: id(),
          otherOwner: id(),
          supplier: id(),
          staff: id(),
          admin: id(),
          inactiveBuyer: id(),
          inactiveStaff: id(),
          inactiveCompanyOwner: id(),
          missingProfile: id(),
          request: id(),
          teammateRequest: id(),
          foreignRequest: id(),
          order: id(),
          plan: id(),
          draftPlan: id(),
          approvedPlan: id(),
          supersededPlan: id(),
          teammatePlan: id(),
          foreignPlan: id(),
        };
        const otherCompany = id();
        const supplierCompany = id();
        await tx`insert into public.companies (id, type, name, is_active) values
        (${w.buyerCompany}, 'buyer', ${`${w.namespace}-buyer`}, true),
        (${otherCompany}, 'buyer', ${`${w.namespace}-foreign`}, true),
        (${supplierCompany}, 'supplier', ${`${w.namespace}-supplier`}, true),
        (${w.inactiveCompany}, 'buyer', ${`${w.namespace}-inactive`}, false)`;
        const users: [string, string | null, string, boolean][] = [
          [w.owner, w.buyerCompany, 'owner', true],
          [w.manager, w.buyerCompany, 'manager', true],
          [w.otherOwner, otherCompany, 'owner', true],
          [w.supplier, supplierCompany, 'owner', true],
          [w.staff, null, 'concierge', true],
          [w.admin, null, 'admin', true],
          [w.inactiveBuyer, w.buyerCompany, 'owner', false],
          [w.inactiveStaff, null, 'concierge', false],
          [w.inactiveCompanyOwner, w.inactiveCompany, 'owner', true],
        ];
        for (const [uid, company, role, active] of users) {
          await tx`insert into auth.users (id) values (${uid})`;
          await tx`insert into public.users
          (id, company_id, role, full_name, email, is_active, approval_limit_kzt)
          values (${uid}, ${company}, ${role}, ${`${w.namespace}-${role}`},
            ${`${w.namespace}-${uid}@example.test`}, ${active}, null)`;
        }
        await tx`insert into auth.users (id) values (${w.missingProfile})`;
        await tx`insert into public.requests (id, buyer_company_id, created_by, title, raw_text) values
        (${w.request}, ${w.buyerCompany}, ${w.owner}, ${`${w.namespace}-own`}, ${w.namespace}),
        (${w.teammateRequest}, ${w.buyerCompany}, ${w.manager}, ${`${w.namespace}-teammate`}, ${w.namespace}),
        (${w.foreignRequest}, ${otherCompany}, ${w.otherOwner}, ${`${w.namespace}-foreign`}, ${w.namespace})`;

        for (const [request, planIds] of [
          [w.request, [w.plan, w.draftPlan, w.approvedPlan, w.supersededPlan]],
          [w.teammateRequest, [w.teammatePlan]],
          [w.foreignRequest, [w.foreignPlan]],
        ] as [string, string[]][]) {
          const item = id();
          const rfq = id();
          const quote = id();
          const quoteLine = id();
          await tx`insert into public.request_items (id, request_id, name, category, qty, unit)
          values (${item}, ${request}, ${`${w.namespace}-item`}, 'merch', 10, 'шт')`;
          await tx`insert into public.rfqs (id, request_id, supplier_company_id, token, status)
          values (${rfq}, ${request}, ${supplierCompany}, ${id()}, 'sent')`;
          await tx`insert into public.quotes (id, rfq_id) values (${quote}, ${rfq})`;
          await tx`insert into public.quote_lines
          (id, quote_id, request_item_id, unit_price_kzt, lead_time_days)
          values (${quoteLine}, ${quote}, ${item}, 10000, 2)`;
          for (const plan of planIds) {
            const status =
              plan === w.draftPlan
                ? 'draft'
                : plan === w.approvedPlan
                  ? 'approved'
                  : plan === w.supersededPlan
                    ? 'superseded'
                    : 'proposed';
            await tx`insert into public.plans
            (id, request_id, version, kind, total_supplier_kzt, delivery_kzt,
             commission_kzt, commission_base, tax_effect_kzt, supplier_rebate_kzt,
             total_kzt, eta_date, slack_days, supplier_count, explanation, status)
            values (${plan}, ${request}, 7, 'recommended', 100000, 5000,
              23000, 'supplier_ex_delivery', 16000, 700, 128700, '2030-06-15', 4, 1,
              ${tx.json({ internalCanary: `${w.namespace}-private-costs`, supplierCost: 100000 })}, ${status})`;
            await tx`insert into public.plan_lines
            (id, plan_id, request_item_id, supplier_company_id, quote_line_id,
             qty, line_total_kzt, commission_pct, commission_kzt)
            values (${id()}, ${plan}, ${item}, ${supplierCompany}, ${quoteLine}, 10, 100000, 23, 23000)`;
          }
        }
        await tx`insert into public.orders (id, request_id, approved_plan_id, state, concierge_user_id)
        values (${w.order}, ${w.request}, ${w.plan}, 'plan_proposed', ${w.staff})`;
        await run(tx, w);
        throw rollback;
      })
      .catch((error) => {
        if (error !== rollback) throw error;
      });
  } finally {
    await sql.end();
  }
}

async function asUser(tx: postgres.TransactionSql, user: string | null) {
  await tx`reset role`;
  await tx`set local role authenticated`;
  await tx`select set_config('request.jwt.claims',
    ${JSON.stringify(user ? { sub: user, role: 'authenticated' } : { role: 'authenticated' })}, true)`;
}

async function asAnon(tx: postgres.TransactionSql) {
  await tx`reset role`;
  await tx`set local role anon`;
  await tx`select set_config('request.jwt.claims', '{}', true)`;
}

async function getPlans(tx: postgres.TransactionSql, ids: string[]) {
  return tx<Record<string, unknown>[]>`
    select * from public.get_buyer_plans(${tx.array(ids)}::uuid[])`;
}

async function approve(tx: postgres.TransactionSql, w: World) {
  return tx`select public.approve_plan(${w.order}, ${w.plan}, 7) as result`;
}

async function assertUnapproved(tx: postgres.TransactionSql, w: World) {
  await tx`reset role`;
  const [row] = await tx`
    select o.state, p.status from public.orders o join public.plans p on p.id = o.approved_plan_id
    where o.id = ${w.order}`;
  expect(row).toEqual({ state: 'plan_proposed', status: 'proposed' });
  const events = await tx`select id from public.order_stage_events where order_id = ${w.order}`;
  expect(events).toHaveLength(0);
}

describeIfConfigured('buyer plan confidentiality: database boundary', () => {
  it.each([
    ['owner', (w: World) => w.owner],
    ['manager', (w: World) => w.manager],
    ['linked supplier', (w: World) => w.supplier],
    ['foreign buyer', (w: World) => w.otherOwner],
    ['inactive buyer', (w: World) => w.inactiveBuyer],
    ['inactive staff', (w: World) => w.inactiveStaff],
  ])('%s cannot read raw plan rows or nested private payloads', async (_label, actor) => {
    await scenario(async (tx, w) => {
      await asUser(tx, actor(w));
      const raw =
        await tx`select to_jsonb(p) as payload from public.plans p where request_id = ${w.request}`;
      expect(raw).toHaveLength(0);
    });
  });

  it('active staff and service_role retain raw financial access', async () => {
    await scenario(async (tx, w) => {
      for (const user of [w.staff, w.admin]) {
        await asUser(tx, user);
        const [row] = await tx`select total_supplier_kzt, commission_kzt, explanation
          from public.plans where id = ${w.plan}`;
        expect(Number(row?.total_supplier_kzt)).toBe(100000);
        expect(Number(row?.commission_kzt)).toBe(23000);
        expect(row?.explanation.internalCanary).toBe(`${w.namespace}-private-costs`);
      }
      await tx`reset role`;
      await tx`set local role service_role`;
      const raw = await tx`select id from public.plans where request_id = ${w.request}`;
      expect(raw).toHaveLength(4);
    });
  });

  it.each([
    ['owner', (w: World) => w.owner],
    ['manager', (w: World) => w.manager],
    ['concierge', (w: World) => w.staff],
    ['admin', (w: World) => w.admin],
  ])('%s receives only the exact buyer DTO', async (_label, actor) => {
    await scenario(async (tx, w) => {
      await asUser(tx, actor(w));
      const rows = await getPlans(tx, [w.request]);
      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.id).sort()).toEqual([w.plan, w.draftPlan, w.approvedPlan].sort());
      expect(rows.map((r) => r.status).sort()).toEqual(['approved', 'draft', 'proposed']);
      for (const row of rows) {
        expect(Object.keys(row).sort()).toEqual(DTO_KEYS);
        expect(row.request_id).toBe(w.request);
        expect(row.version).toBe(7);
        expect(row.kind).toBe('recommended');
        expect(Number(row.delivery_kzt)).toBe(5000);
        expect(Number(row.supplier_rebate_kzt)).toBe(700);
        expect(Number(row.total_kzt)).toBe(128700);
        const eta =
          row.eta_date instanceof Date ? row.eta_date.toISOString().slice(0, 10) : row.eta_date;
        expect(eta).toBe('2030-06-15');
        expect(row.slack_days).toBe(4);
        expect(row.supplier_count).toBe(1);
      }
      expect(JSON.stringify(rows)).not.toContain('private-costs');
    });
  });

  it('same-company reads ignore created_by and filter mixed foreign, duplicate and nonexistent IDs', async () => {
    await scenario(async (tx, w) => {
      await asUser(tx, w.owner);
      const rows = await getPlans(tx, [
        w.request,
        w.teammateRequest,
        w.foreignRequest,
        w.request,
        crypto.randomUUID(),
      ]);
      expect(rows.map((r) => r.id).sort()).toEqual(
        [w.plan, w.draftPlan, w.approvedPlan, w.teammatePlan].sort(),
      );
      await asUser(tx, w.manager);
      expect((await getPlans(tx, [w.request])).map((r) => r.id).sort()).toEqual(
        [w.plan, w.draftPlan, w.approvedPlan].sort(),
      );
    });
  });

  it.each([
    ['foreign buyer', (w: World) => w.otherOwner],
    ['linked supplier', (w: World) => w.supplier],
    ['inactive buyer', (w: World) => w.inactiveBuyer],
    ['inactive staff', (w: World) => w.inactiveStaff],
    ['missing profile', (w: World) => w.missingProfile],
    ['missing JWT subject', (_w: World) => null],
  ])('%s receives an empty DTO result', async (_label, actor) => {
    await scenario(async (tx, w) => {
      await asUser(tx, actor(w));
      expect(await getPlans(tx, [w.request])).toHaveLength(0);
    });
  });

  it('deactivating the owning buyer company revokes DTO access immediately', async () => {
    await scenario(async (tx, w) => {
      await tx`update public.companies set is_active = false where id = ${w.buyerCompany}`;
      await asUser(tx, w.owner);
      expect(await getPlans(tx, [w.request])).toHaveLength(0);
    });
  });

  it('null and empty request-ID arrays return no rows', async () => {
    await scenario(async (tx, w) => {
      await asUser(tx, w.owner);
      expect(await getPlans(tx, [])).toHaveLength(0);
      expect(await tx`select * from public.get_buyer_plans(null::uuid[])`).toHaveLength(0);
    });
  });

  it('DTO rows cannot be joined back to raw plan costs or supplier lines', async () => {
    await scenario(async (tx, w) => {
      await asUser(tx, w.owner);
      const rows = await tx`
        select b.id, p.total_supplier_kzt, p.commission_kzt, p.commission_base,
          p.tax_effect_kzt, p.explanation, pl.line_total_kzt, pl.supplier_company_id
        from public.get_buyer_plans(array[${w.request}]::uuid[]) b
        left join public.plans p on p.id = b.id
        left join public.plan_lines pl on pl.plan_id = b.id`;
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(Object.values(row).filter((value) => value !== null)).toEqual([row.id]);
      }
    });
  });

  it('anon cannot execute the DTO or approval RPC', async () => {
    await scenario(async (tx, w) => {
      await asAnon(tx);
      await expect(tx.savepoint((sp) => getPlans(sp, [w.request]))).rejects.toThrow(
        /permission denied/,
      );
      await expect(tx.savepoint((sp) => approve(sp, w))).rejects.toThrow(/permission denied/);
    });
  });

  it('DTO is STABLE, SECURITY DEFINER, hardened and not executable by PUBLIC, anon or service_role', async () => {
    await scenario(async (tx) => {
      const rows = await tx`
        select p.prosecdef, p.provolatile, p.proconfig, p.pronargs,
          oidvectortypes(p.proargtypes) as arguments,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
          has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
          has_function_privilege('service_role', p.oid, 'EXECUTE') as service,
          exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_execute
        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'get_buyer_plans'`;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        prosecdef: true,
        provolatile: 's',
        pronargs: 1,
        arguments: 'uuid[]',
        authenticated: true,
        anon: false,
        service: false,
        public_execute: false,
      });
      expect(rows[0]?.proconfig).toContain('search_path=""');
    });
  });

  it('approval has only the three-argument void signature; plan changes remain invoker', async () => {
    await scenario(async (tx) => {
      const rows = await tx`
        select p.prorettype::regtype::text as result_type, oidvectortypes(p.proargtypes) as arguments,
          p.prosecdef, p.proconfig,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
          has_function_privilege('service_role', p.oid, 'EXECUTE') as service,
          has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
          exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_execute
        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'approve_plan'`;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        result_type: 'void',
        arguments: 'uuid, uuid, integer',
        prosecdef: true,
        authenticated: true,
        service: true,
        anon: false,
        public_execute: false,
      });
      expect(rows[0]?.proconfig).toContain('search_path=""');
      const [change] = await tx`select prosecdef, proconfig from pg_proc
        where oid = 'public.request_plan_change(uuid,text,bigint,bigint)'::regprocedure`;
      expect(change?.prosecdef).toBe(false);
      expect(change?.proconfig).toContain('search_path=""');
    });
  });

  it('approval and idempotent retry return no financial payload and audit only once', async () => {
    await scenario(async (tx, w) => {
      await asUser(tx, w.owner);
      for (let attempt = 0; attempt < 2; attempt++) {
        const [row] =
          await tx`select public.approve_plan(${w.order}, ${w.plan}, 7)::text as result`;
        expect(row?.result).toBe('');
      }
      await tx`set constraints all immediate`;
      await tx`reset role`;
      const [order] =
        await tx`select state, approved_plan_id from public.orders where id = ${w.order}`;
      expect(order).toEqual({ state: 'plan_approved', approved_plan_id: w.plan });
      const [plan] = await tx`select status from public.plans where id = ${w.plan}`;
      expect(plan?.status).toBe('approved');
      const events =
        await tx`select from_state, to_state, actor_user_id from public.order_stage_events
        where order_id = ${w.order}`;
      expect(events).toEqual([
        { from_state: 'plan_proposed', to_state: 'plan_approved', actor_user_id: w.owner },
      ]);
    });
  });

  it('foreign-company approval is denied without a write', async () => {
    await scenario(async (tx, w) => {
      await asUser(tx, w.otherOwner);
      await expect(tx.savepoint((sp) => approve(sp, w))).rejects.toThrow(/Нет доступа к заказу/);
      await assertUnapproved(tx, w);
    });
  });

  it('supplier, staff, inactive and missing profiles and missing JWT cannot approve', async () => {
    await scenario(async (tx, w) => {
      for (const user of [
        w.supplier,
        w.staff,
        w.admin,
        w.inactiveBuyer,
        w.inactiveStaff,
        w.inactiveCompanyOwner,
        w.missingProfile,
        null,
      ]) {
        await asUser(tx, user);
        await expect(tx.savepoint((sp) => approve(sp, w))).rejects.toThrow(
          /Только покупатель может утвердить план/,
        );
      }
      await assertUnapproved(tx, w);
    });
  });

  it('revoked approval permission is enforced even for an owner', async () => {
    await scenario(async (tx, w) => {
      await tx`insert into public.permissions (user_id, key, value)
        values (${w.owner}, 'can_approve_plan', 'false'::jsonb)`;
      await asUser(tx, w.owner);
      await expect(tx.savepoint((sp) => approve(sp, w))).rejects.toThrow(
        /Право утверждать планы отозвано/,
      );
      await assertUnapproved(tx, w);
    });
  });

  it('owner approval limit is enforced', async () => {
    await scenario(async (tx, w) => {
      await tx`update public.users set approval_limit_kzt = 128699 where id = ${w.owner}`;
      await asUser(tx, w.owner);
      await expect(tx.savepoint((sp) => approve(sp, w))).rejects.toThrow(
        /Сумма превышает лимит согласования владельца/,
      );
      await assertUnapproved(tx, w);
    });
  });

  it('manager approval escalates over the limit and succeeds at the limit without returning costs', async () => {
    await scenario(async (tx, w) => {
      await tx`update public.users set approval_limit_kzt = 128699 where id = ${w.manager}`;
      await asUser(tx, w.manager);
      const [escalated] =
        await tx`select public.approve_plan(${w.order}, ${w.plan}, 7)::text as result`;
      expect(escalated?.result).toBe('');
      await tx`reset role`;
      const [pending] = await tx`select o.state, p.status from public.orders o
        join public.plans p on p.id = o.approved_plan_id where o.id = ${w.order}`;
      expect(pending).toEqual({ state: 'awaiting_internal_approval', status: 'proposed' });
      await tx`update public.users set approval_limit_kzt = 128700 where id = ${w.manager}`;
      await asUser(tx, w.manager);
      const [approved] =
        await tx`select public.approve_plan(${w.order}, ${w.plan}, 7)::text as result`;
      expect(approved?.result).toBe('');
      await tx`reset role`;
      const [done] = await tx`select o.state, p.status from public.orders o
        join public.plans p on p.id = o.approved_plan_id where o.id = ${w.order}`;
      expect(done).toEqual({ state: 'plan_approved', status: 'approved' });
    });
  });

  it('optimistic expected plan ID and version reject stale approvals without writes', async () => {
    await scenario(async (tx, w) => {
      await asUser(tx, w.owner);
      await expect(
        tx.savepoint((sp) => sp`select public.approve_plan(${w.order}, ${w.foreignPlan}, 7)`),
      ).rejects.toThrow(/План уже изменён/);
      await expect(
        tx.savepoint((sp) => sp`select public.approve_plan(${w.order}, ${w.plan}, 6)`),
      ).rejects.toThrow(/Версия плана уже изменена/);
      await assertUnapproved(tx, w);
    });
  });

  it('an authorized buyer can request a plan change and its buyer-thread message after approval', async () => {
    await scenario(async (tx, w) => {
      await asUser(tx, w.owner);
      await approve(tx, w);
      const reason = `${w.namespace}-increase quantity`;
      const [row] =
        await tx`select public.request_plan_change(${w.order}, ${reason}, 15000, 300) as id`;
      expect(row?.id).toBeTruthy();
      await tx`reset role`;
      const changes = await tx`select proposed_plan_id, initiator_user_id, status, diff
        from public.change_requests where order_id = ${w.order}`;
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({
        proposed_plan_id: w.plan,
        initiator_user_id: w.owner,
        status: 'pending',
        diff: {
          reason,
          requestedSupplierDeltaKzt: 15000,
          requestedDeliveryDeltaKzt: 300,
          expectedPlanId: w.plan,
          expectedPlanVersion: 7,
        },
      });
      const messages = await tx`select m.body, m.author_user_id from public.messages m
        join public.threads t on t.id = m.thread_id where t.order_id = ${w.order} and t.kind = 'buyer'`;
      expect(messages).toContainEqual({
        body: `Запрос изменения условий: ${reason}`,
        author_user_id: w.owner,
      });
    });
  });

  it('foreign buyer and supplier cannot write plan changes or buyer messages', async () => {
    await scenario(async (tx, w) => {
      await asUser(tx, w.owner);
      await approve(tx, w);
      for (const user of [w.otherOwner, w.supplier]) {
        await asUser(tx, user);
        await expect(
          tx.savepoint(
            (sp) => sp`select public.request_plan_change(
          ${w.order}, ${`${w.namespace}-unauthorized`}, 15000, 300)`,
          ),
        ).rejects.toThrow(/Заказ не найден или недоступен|План уже изменён|row-level security/);
      }
      await tx`reset role`;
      expect(
        await tx`select id from public.change_requests where order_id = ${w.order}`,
      ).toHaveLength(0);
      expect(
        await tx`select m.id from public.messages m join public.threads t on t.id = m.thread_id
        where t.order_id = ${w.order} and m.author_user_id in (${w.otherOwner}, ${w.supplier})`,
      ).toHaveLength(0);
    });
  });
});
