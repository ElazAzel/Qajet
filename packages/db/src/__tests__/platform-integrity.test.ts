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
      await tx`update orders set state = 'plan_approved' where id = ${f[11]}`;
      await asUser(tx, f[2]);
      await expect(
        tx.savepoint((sp) => sp`update orders set state = 'suppliers_paid' where id = ${f[11]}`),
      ).rejects.toThrow();
    }));
  it('approval changes plan, order and history together', async () =>
    scenario(async (tx, f) => {
      await asUser(tx, f[2]);
      await tx`select approve_plan(${f[11]})`;
      expect((await tx`select state from orders where id = ${f[11]}`)[0]?.state).toBe(
        'plan_approved',
      );
      expect(
        await tx`select id from order_stage_events where order_id = ${f[11]} and to_state = 'plan_approved'`,
      ).toHaveLength(1);
    }));
  it('manager above personal limit sends the order to the owner', async () =>
    scenario(async (tx, f) => {
      await tx`update public.users set role = 'manager', approval_limit_kzt = 100000 where id = ${f[2]}`;
      await asUser(tx, f[2]);
      await tx`select approve_plan(${f[11]})`;
      expect((await tx`select state from orders where id = ${f[11]}`)[0]?.state).toBe(
        'awaiting_internal_approval',
      );
      expect((await tx`select status from plans where id = ${f[10]}`)[0]?.status).toBe('proposed');
    }));
  it('revoked approval permission still blocks the atomic RPC', async () =>
    scenario(async (tx, f) => {
      await tx`insert into permissions(user_id, key, value) values (${f[2]}, 'can_approve_plan', 'false')`;
      await asUser(tx, f[2]);
      await expect(tx.savepoint((sp) => sp`select approve_plan(${f[11]})`)).rejects.toThrow(
        'отозвано',
      );
      expect((await tx`select state from orders where id = ${f[11]}`)[0]?.state).toBe(
        'plan_proposed',
      );
      expect((await tx`select status from plans where id = ${f[10]}`)[0]?.status).toBe('proposed');
    }));
  it('approved plans can be superseded without unlocking their terms', async () =>
    scenario(async (tx, f) => {
      await asUser(tx, f[2]);
      await tx`select approve_plan(${f[11]})`;
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
      await expect(
        tx.savepoint((sp) => sp`update rfqs set status = 'declined' where id = ${f[9]}`),
      ).rejects.toThrow();
      expect(await tx`select id from quotes where rfq_id = ${f[9]}`).toHaveLength(1);
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
      await tx`select approve_plan(${f[11]})`;
      await asUser(tx, f[3]);
      await expect(
        tx.savepoint((sp) => sp`update plan_lines set commission_pct = 24 where id = ${line}`),
      ).rejects.toThrow();
      await expect(
        tx.savepoint((sp) => sp`update plans set total_kzt = 1 where id = ${f[10]}`),
      ).rejects.toThrow();
    }));
});
