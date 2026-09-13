import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;
const rollback = new Error('fixture rollback');

/** Every case rolls back its own fixtures, including on assertion failure. */
async function scenario(run: (tx: postgres.TransactionSql, f: Fixture) => Promise<void>) {
  const sql = postgres(databaseUrl as string, { max: 1, prepare: false });
  try {
    await sql
      .begin(async (tx) => {
        const ids = Array.from({ length: 12 }, () => crypto.randomUUID());
        const [
          buyer,
          supplier,
          user,
          staff,
          supplierUser,
          request,
          otherRequest,
          item,
          otherItem,
          rfq,
          plan,
          order,
        ] = ids as Fixture;
        await tx`insert into companies (id, type, name) values (${buyer}, 'buyer', 'Integrity buyer'), (${supplier}, 'supplier', 'Integrity supplier')`;
        await tx`insert into auth.users (id) values (${user}), (${staff}), (${supplierUser})`;
        await tx`insert into public.users (id, company_id, role, full_name, email) values
        (${user}, ${buyer}, 'owner', 'Buyer', 'integrity-buyer@example.com'),
        (${staff}, null, 'concierge', 'Staff', 'integrity-staff@example.com'),
        (${supplierUser}, ${supplier}, 'owner', 'Supplier', 'integrity-supplier@example.com')`;
        await tx`insert into requests (id, buyer_company_id, created_by, title, raw_text) values
        (${request}, ${buyer}, ${user}, 'Test', 'Test'), (${otherRequest}, ${buyer}, ${user}, 'Other', 'Other')`;
        await tx`insert into request_items (id, request_id, name, category, qty, unit) values
        (${item}, ${request}, 'Test', 'merch', 10, 'шт'), (${otherItem}, ${otherRequest}, 'Other', 'merch', 10, 'шт')`;
        await tx`insert into rfqs (id, request_id, supplier_company_id, token) values (${rfq}, ${request}, ${supplier}, ${crypto.randomUUID()}),
        (${crypto.randomUUID()}, ${otherRequest}, ${supplier}, ${crypto.randomUUID()})`;
        await tx`insert into plans (id, request_id, kind, total_supplier_kzt, delivery_kzt, commission_kzt, commission_base, total_kzt, supplier_count, explanation, status)
        values (${plan}, ${request}, 'recommended', 100000, 0, 23000, 'supplier_ex_delivery', 123000, 1, '{}', 'proposed')`;
        await tx`insert into orders (id, request_id, approved_plan_id, state, concierge_user_id) values (${order}, ${request}, ${plan}, 'plan_proposed', ${staff})`;
        await run(tx, [
          buyer,
          supplier,
          user,
          staff,
          supplierUser,
          request,
          otherRequest,
          item,
          otherItem,
          rfq,
          plan,
          order,
        ]);
        throw rollback;
      })
      .catch((error) => {
        if (error !== rollback) throw error;
      });
  } finally {
    await sql.end();
  }
}
type Fixture = [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];
async function asUser(tx: postgres.TransactionSql, id: string) {
  await tx`set local role authenticated`;
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: id, role: 'authenticated' })}, true)`;
}

/** Approval fixtures must contain a real, internally consistent plan line. */
async function addApprovalLine(tx: postgres.TransactionSql, f: Fixture) {
  const existing = await tx`select id from plan_lines where plan_id = ${f[10]} limit 1`;
  if (existing.length > 0) return;
  const quote = crypto.randomUUID();
  const quoteLine = crypto.randomUUID();
  const planLine = crypto.randomUUID();
  await tx`insert into quotes (id, rfq_id) values (${quote}, ${f[9]})`;
  await tx`insert into quote_lines (id, quote_id, request_item_id, unit_price_kzt, lead_time_days)
    values (${quoteLine}, ${quote}, ${f[7]}, 10000, 2)`;
  await tx`insert into plan_lines (
    id, plan_id, request_item_id, supplier_company_id, quote_line_id,
    qty, line_total_kzt, commission_pct, commission_kzt
  ) values (
    ${planLine}, ${f[10]}, ${f[7]}, ${f[1]}, ${quoteLine}, 10, 100000, 23, 23000
  )`;
}

async function addSupplierPayoutFact(
  tx: postgres.TransactionSql,
  orderId: string,
  supplierCompanyId: string,
  amountKzt: number,
  confirmedBy: string,
) {
  await tx`insert into payment_facts (
    order_id, supplier_company_id, direction, kind, status, amount_kzt,
    reference, confirmed_by, idempotency_key
  ) values (
    ${orderId}, ${supplierCompanyId}, 'outbound', 'supplier_payout', 'confirmed',
    ${amountKzt}, ${`test-bank-${crypto.randomUUID()}`}, ${confirmedBy}, ${`test-payment-${crypto.randomUUID()}`}
  )`;
}

async function approvePlan(tx: postgres.TransactionSql, orderId: string) {
  const plan = (
    await tx<{ id: string; version: number }[]>`
      select p.id, p.version
      from orders o
      join plans p on p.id = o.approved_plan_id
      where o.id = ${orderId}
    `
  )[0];
  if (!plan) throw new Error('Тестовая фикстура не содержит план заказа.');
  return tx`select approve_plan(${orderId}, ${plan.id}, ${plan.version})`;
}

describe.skipIf(!databaseUrl)('platform integrity under real PostgreSQL RLS', () => {
  it('supplier cannot attach a quote line from another request', async () =>
    scenario(async (tx, f) => {
      const quote = crypto.randomUUID();
      await tx`insert into quotes (id, rfq_id) values (${quote}, ${f[9]})`;
      await asUser(tx, f[4]);
      await expect(
        tx.savepoint(
          (
            sp,
          ) => sp`insert into quote_lines (quote_id, request_item_id, unit_price_kzt, lead_time_days)
      values (${quote}, ${f[8]}, 100, 2)`,
        ),
      ).rejects.toThrow();
    }));
  it('supplier cannot submit a negative price through the database API', async () =>
    scenario(async (tx, f) => {
      const quote = crypto.randomUUID();
      await tx`insert into quotes (id, rfq_id) values (${quote}, ${f[9]})`;
      await asUser(tx, f[4]);
      await expect(
        tx.savepoint(
          (
            sp,
          ) => sp`insert into quote_lines (quote_id, request_item_id, unit_price_kzt, lead_time_days)
      values (${quote}, ${f[7]}, -100, 2)`,
        ),
      ).rejects.toThrow();
    }));
  it('buyer cannot mark suppliers paid through a direct update', async () =>
    scenario(async (tx, f) => {
      await addApprovalLine(tx, f);
      await asUser(tx, f[2]);
      await approvePlan(tx, f[11]);
      await asUser(tx, f[2]);
      await expect(
        tx.savepoint((sp) => sp`update orders set state = 'suppliers_paid' where id = ${f[11]}`),
      ).rejects.toThrow();
    }));
  it('approval changes plan, order and history together', async () =>
    scenario(async (tx, f) => {
      await addApprovalLine(tx, f);
      await asUser(tx, f[2]);
      await approvePlan(tx, f[11]);
      expect((await tx`select state from orders where id = ${f[11]}`)[0]?.state).toBe(
        'plan_approved',
      );
      expect(
        await tx`select id from order_stage_events where order_id = ${f[11]} and to_state = 'plan_approved'`,
      ).toHaveLength(1);
    }));
  it('supplier confirmation is the only way to move a paid order to delivered', async () =>
    scenario(async (tx, f) => {
      const quote = crypto.randomUUID();
      const quoteLine = crypto.randomUUID();
      const planLine = crypto.randomUUID();
      await tx`insert into quotes (id, rfq_id) values (${quote}, ${f[9]})`;
      await tx`insert into quote_lines (id, quote_id, request_item_id, unit_price_kzt, lead_time_days)
        values (${quoteLine}, ${quote}, ${f[7]}, 100000, 2)`;
      await tx`insert into plan_lines (id, plan_id, request_item_id, supplier_company_id, quote_line_id, qty, line_total_kzt, commission_pct, commission_kzt)
        values (${planLine}, ${f[10]}, ${f[7]}, ${f[1]}, ${quoteLine}, 10, 100000, 23, 23000)`;

      await asUser(tx, f[2]);
      await approvePlan(tx, f[11]);
      await asUser(tx, f[3]);
      await addSupplierPayoutFact(tx, f[11], f[1], 100000, f[3]);
      await tx`insert into supplier_payouts (order_id, supplier_company_id, amount_kzt, status, paid_at)
        values (${f[11]}, ${f[1]}, 100000, 'paid', now())`;
      await tx`update orders set state = 'suppliers_paid' where id = ${f[11]}`;
      await tx`update orders set state = 'in_production' where id = ${f[11]}`;
      await tx`update orders set state = 'shipped' where id = ${f[11]}`;

      await expect(
        tx.savepoint((sp) => sp`update orders set state = 'delivered' where id = ${f[11]}`),
      ).rejects.toThrow('Поставщик');

      await asUser(tx, f[4]);
      await tx`select confirm_supplier_delivery(${f[11]})`;
      expect((await tx`select state from orders where id = ${f[11]}`)[0]?.state).toBe('delivered');
      const event = await tx`select actor_user_id, from_state, to_state from order_stage_events
        where order_id = ${f[11]} and to_state = 'delivered'`;
      expect(event).toHaveLength(1);
      expect(event[0]?.actor_user_id).toBe(f[4]);
      expect(event[0]?.from_state).toBe('shipped');

      await asUser(tx, f[3]);
      await expect(
        tx.savepoint((sp) => sp`update orders set state = 'accepted' where id = ${f[11]}`),
      ).rejects.toThrow('другой участник');

      await asUser(tx, f[2]);
      await tx`update orders set state = 'accepted', accepted_at = now() where id = ${f[11]}`;
      expect((await tx`select state from orders where id = ${f[11]}`)[0]?.state).toBe('accepted');
    }));
  it('a multi-supplier order waits for every supplier confirmation', async () =>
    scenario(async (tx, f) => {
      const supplierB = crypto.randomUUID();
      const supplierBUser = crypto.randomUUID();
      const rfqB = crypto.randomUUID();
      const quoteA = crypto.randomUUID();
      const quoteB = crypto.randomUUID();
      const lineA = crypto.randomUUID();
      const lineB = crypto.randomUUID();
      const planLineA = crypto.randomUUID();
      const planLineB = crypto.randomUUID();

      await tx`insert into companies (id, type, name) values (${supplierB}, 'supplier', 'Integrity supplier B')`;
      await tx`insert into auth.users (id) values (${supplierBUser})`;
      await tx`insert into public.users (id, company_id, role, full_name, email) values
        (${supplierBUser}, ${supplierB}, 'owner', 'Supplier B', 'integrity-supplier-b@example.com')`;
      await tx`insert into rfqs (id, request_id, supplier_company_id, token) values
        (${rfqB}, ${f[5]}, ${supplierB}, ${crypto.randomUUID()})`;
      await tx`insert into quotes (id, rfq_id) values (${quoteA}, ${f[9]}), (${quoteB}, ${rfqB})`;
      await tx`insert into quote_lines (id, quote_id, request_item_id, unit_price_kzt, lead_time_days) values
        (${lineA}, ${quoteA}, ${f[7]}, 50000, 2), (${lineB}, ${quoteB}, ${f[7]}, 50000, 2)`;
      await tx`insert into plan_lines (id, plan_id, request_item_id, supplier_company_id, quote_line_id, qty, line_total_kzt, commission_pct, commission_kzt) values
        (${planLineA}, ${f[10]}, ${f[7]}, ${f[1]}, ${lineA}, 5, 50000, 23, 11500),
        (${planLineB}, ${f[10]}, ${f[7]}, ${supplierB}, ${lineB}, 5, 50000, 23, 11500)`;
      await tx`update plans set supplier_count = 2 where id = ${f[10]}`;

      await asUser(tx, f[2]);
      await approvePlan(tx, f[11]);
      await asUser(tx, f[3]);
      await addSupplierPayoutFact(tx, f[11], f[1], 50000, f[3]);
      await addSupplierPayoutFact(tx, f[11], supplierB, 50000, f[3]);
      await tx`insert into supplier_payouts (order_id, supplier_company_id, amount_kzt, status, paid_at) values
        (${f[11]}, ${f[1]}, 50000, 'paid', now()), (${f[11]}, ${supplierB}, 50000, 'paid', now())`;
      await tx`update orders set state = 'suppliers_paid' where id = ${f[11]}`;
      await tx`update orders set state = 'in_production' where id = ${f[11]}`;
      await tx`update orders set state = 'shipped' where id = ${f[11]}`;

      await asUser(tx, f[4]);
      expect(
        (await tx`select confirm_supplier_delivery(${f[11]})`)[0]?.confirm_supplier_delivery,
      ).toBe(false);
      expect((await tx`select state from orders where id = ${f[11]}`)[0]?.state).toBe('shipped');

      await asUser(tx, supplierBUser);
      expect(
        (await tx`select confirm_supplier_delivery(${f[11]})`)[0]?.confirm_supplier_delivery,
      ).toBe(true);
      expect((await tx`select state from orders where id = ${f[11]}`)[0]?.state).toBe('delivered');
      expect(
        await tx`select id from order_stage_events where order_id = ${f[11]} and to_state = 'delivered'`,
      ).toHaveLength(1);
    }));
  it('authenticated staff cannot fabricate an order audit row', async () =>
    scenario(async (tx, f) => {
      await asUser(tx, f[3]);
      await expect(
        tx.savepoint(
          (sp) => sp`insert into order_stage_events(order_id, to_state, actor_user_id)
            values (${f[11]}, 'draft', ${f[3]})`,
        ),
      ).rejects.toThrow();
    }));
  it('manager above personal limit sends the order to the owner', async () =>
    scenario(async (tx, f) => {
      await tx`update public.users set role = 'manager', approval_limit_kzt = 100000 where id = ${f[2]}`;
      await addApprovalLine(tx, f);
      await asUser(tx, f[2]);
      await approvePlan(tx, f[11]);
      expect((await tx`select state from orders where id = ${f[11]}`)[0]?.state).toBe(
        'awaiting_internal_approval',
      );
      expect((await tx`select status from plans where id = ${f[10]}`)[0]?.status).toBe('proposed');
    }));
  it('revoked approval permission still blocks the atomic RPC', async () =>
    scenario(async (tx, f) => {
      await addApprovalLine(tx, f);
      await tx`insert into permissions(user_id, key, value) values (${f[2]}, 'can_approve_plan', 'false')`;
      await asUser(tx, f[2]);
      await expect(tx.savepoint((sp) => approvePlan(sp, f[11]))).rejects.toThrow('отозвано');
      expect((await tx`select state from orders where id = ${f[11]}`)[0]?.state).toBe(
        'plan_proposed',
      );
      expect((await tx`select status from plans where id = ${f[10]}`)[0]?.status).toBe('proposed');
    }));
  it('approved plans can be superseded without unlocking their terms', async () =>
    scenario(async (tx, f) => {
      await addApprovalLine(tx, f);
      await asUser(tx, f[2]);
      await approvePlan(tx, f[11]);
      const events = await tx`select note from order_stage_events where order_id = ${f[11]}`;
      expect(events[0]?.note).toContain(f[10]);
      await asUser(tx, f[3]);
      await tx`update plans set status = 'superseded' where id = ${f[10]}`;
      await expect(
        tx.savepoint((sp) => sp`update plans set total_kzt = 1 where id = ${f[10]}`),
      ).rejects.toThrow();
    }));
  it('staff cannot split items after RFQs have been sent', async () =>
    scenario(async (tx, f) => {
      await asUser(tx, f[3]);
      await expect(
        tx.savepoint(
          (sp) =>
            sp`select split_request_item(${f[7]}, ${sp.json([
              { name: 'A', qty: 5 },
              { name: 'B', qty: 5 },
            ])})`,
        ),
      ).rejects.toThrow();
    }));
  it('merge rejects missing ids instead of silently replacing the remaining item', async () =>
    scenario(async (tx, f) => {
      await tx`delete from orders where id = ${f[11]}`;
      await asUser(tx, f[3]);
      await expect(
        tx.savepoint((sp) => sp`select merge_request_items(${[f[7], crypto.randomUUID()]})`),
      ).rejects.toThrow();
    }));
  it('a failed quote rolls back its header; retry and duplicate submission are safe', async () =>
    scenario(async (tx, f) => {
      await asUser(tx, f[4]);
      const good = { requestItemId: f[7], unitPriceKzt: 100, leadTimeDays: 2 };
      await expect(
        tx.savepoint(
          (sp) =>
            sp`select submit_supplier_quote(${f[9]}, ${sp.json([good, { ...good, requestItemId: f[8] }])})`,
        ),
      ).rejects.toThrow();
      expect(await tx`select id from quotes where rfq_id = ${f[9]}`).toHaveLength(0);
      expect((await tx`select status from rfqs where id = ${f[9]}`)[0]?.status).toBe('sent');
      await tx`select submit_supplier_quote(${f[9]}, ${tx.json([good])})`;
      expect((await tx`select status from rfqs where id = ${f[9]}`)[0]?.status).toBe('quoted');
      await expect(
        tx.savepoint((sp) => sp`select submit_supplier_quote(${f[9]}, ${sp.json([good])})`),
      ).rejects.toThrow();
      const declined = await tx.savepoint(
        (sp) => sp`update rfqs set status = 'declined' where id = ${f[9]} returning id`,
      );
      expect(declined).toHaveLength(0);
      expect((await tx`select status from rfqs where id = ${f[9]}`)[0]?.status).toBe('quoted');
      expect(await tx`select id from quotes where rfq_id = ${f[9]}`).toHaveLength(1);
    }));
  it('buyer rating is bound to a closed order and refreshes supplier stats', async () =>
    scenario(async (tx, f) => {
      const quote = crypto.randomUUID();
      const quoteLine = crypto.randomUUID();
      const planLine = crypto.randomUUID();
      await tx`insert into quotes (id, rfq_id) values (${quote}, ${f[9]})`;
      await tx`insert into quote_lines (id, quote_id, request_item_id, unit_price_kzt, lead_time_days)
        values (${quoteLine}, ${quote}, ${f[7]}, 100000, 2)`;
      await tx`insert into plan_lines (id, plan_id, request_item_id, supplier_company_id, quote_line_id, qty, line_total_kzt, commission_pct, commission_kzt)
        values (${planLine}, ${f[10]}, ${f[7]}, ${f[1]}, ${quoteLine}, 10, 100000, 23, 23000)`;

      await asUser(tx, f[2]);
      await approvePlan(tx, f[11]);
      await asUser(tx, f[3]);
      await addSupplierPayoutFact(tx, f[11], f[1], 100000, f[3]);
      await tx`insert into supplier_payouts (order_id, supplier_company_id, amount_kzt, status, paid_at)
        values (${f[11]}, ${f[1]}, 100000, 'paid', now())`;
      await tx`update orders set state = 'suppliers_paid' where id = ${f[11]}`;
      await tx`update orders set state = 'in_production' where id = ${f[11]}`;
      await tx`update orders set state = 'shipped' where id = ${f[11]}`;
      await asUser(tx, f[4]);
      expect(
        (await tx`select confirm_supplier_delivery(${f[11]})`)[0]?.confirm_supplier_delivery,
      ).toBe(true);
      await asUser(tx, f[3]);
      await tx`insert into payment_facts (
        order_id, direction, kind, status, amount_kzt, reference, confirmed_by, idempotency_key
      ) values (
        ${f[11]}, 'inbound', 'prepayment', 'confirmed', 123000,
        ${`test-prepayment-${crypto.randomUUID()}`}, ${f[3]}, ${`test-prepayment-key-${crypto.randomUUID()}`}
      )`;
      await asUser(tx, f[2]);
      await tx`update orders set state = 'accepted', accepted_at = now() where id = ${f[11]}`;
      await tx`update orders
        set state = 'closed', settlement = 'exact', settlement_amount_kzt = 0,
            final_cost_kzt = 123000, closed_at = now()
        where id = ${f[11]}`;

      await expect(
        tx.savepoint(
          (
            sp,
          ) => sp`insert into ratings(order_id, supplier_company_id, buyer_score_1_5, was_on_time, had_dispute)
            values (${f[11]}, ${f[1]}, 5, true, false)`,
        ),
      ).rejects.toThrow();

      expect(
        (await tx`select submit_supplier_rating(${f[11]}, ${f[1]}, 5, true, false, 'Хорошо')`)[0]
          ?.submit_supplier_rating,
      ).toBe(true);
      expect((await tx`select * from get_buyer_rating_targets(${f[11]})`)[0]).toMatchObject({
        supplier_company_id: f[1],
        rated: true,
      });
      await expect(
        tx.savepoint(
          (sp) => sp`select submit_supplier_rating(${f[11]}, ${f[1]}, 4, true, false, null)`,
        ),
      ).rejects.toThrow('уже отправлена');

      await tx`reset role`;
      const stats = (
        await tx`select orders_total, orders_on_time, orders_disputed, avg_buyer_score, rfq_sent, rfq_answered
          from supplier_stats where company_id = ${f[1]}`
      )[0];
      expect(stats).toMatchObject({
        orders_total: 1,
        orders_on_time: 1,
        orders_disputed: 0,
        avg_buyer_score: 5,
        rfq_sent: 2,
        rfq_answered: 1,
      });
    }));
  it('outbox is readable and writable only by staff', async () =>
    scenario(async (tx, f) => {
      const message = crypto.randomUUID();
      await asUser(tx, f[2]);
      await expect(
        tx.savepoint(
          (sp) => sp`insert into outbox(id, kind, recipient, subject, body)
            values (${message}, 'test', 'supplier@example.com', 'Test', 'Test')`,
        ),
      ).rejects.toThrow();

      await asUser(tx, f[3]);
      await tx`insert into outbox(id, kind, recipient, subject, body)
        values (${message}, 'test', 'supplier@example.com', 'Test', 'Test')`;
      expect(await tx`select id from outbox where id = ${message}`).toHaveLength(1);

      await asUser(tx, f[2]);
      expect(await tx`select id from outbox where id = ${message}`).toHaveLength(0);
    }));
  it('commission edit updates the plan total atomically and freezes after approval', async () =>
    scenario(async (tx, f) => {
      const quote = crypto.randomUUID();
      const quoteLine = crypto.randomUUID();
      const line = crypto.randomUUID();
      await tx`insert into quotes(id,rfq_id) values (${quote},${f[9]})`;
      await tx`insert into quote_lines(id,quote_id,request_item_id,unit_price_kzt,lead_time_days) values (${quoteLine},${quote},${f[7]},10000,2)`;
      await tx`insert into plan_lines(id,plan_id,request_item_id,supplier_company_id,quote_line_id,qty,line_total_kzt,commission_pct,commission_kzt)
      values(${line},${f[10]},${f[7]},${f[1]},${quoteLine},10,100000,23,23000)`;
      await asUser(tx, f[3]);
      await tx`update plan_lines set commission_pct = 21 where id = ${line}`;
      expect(
        Number((await tx`select total_kzt from plans where id = ${f[10]}`)[0]?.total_kzt),
      ).toBe(121000);
      await asUser(tx, f[2]);
      await approvePlan(tx, f[11]);
      await asUser(tx, f[3]);
      await expect(
        tx.savepoint((sp) => sp`update plan_lines set commission_pct = 24 where id = ${line}`),
      ).rejects.toThrow();
      await expect(
        tx.savepoint((sp) => sp`update plans set total_kzt = 1 where id = ${f[10]}`),
      ).rejects.toThrow();
    }));
});
