import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;
const rollback = new Error('fixture rollback');
const suite = databaseUrl ? describe : describe.skip;

type Actor =
  | 'admin'
  | 'concierge'
  | 'buyer'
  | 'otherBuyer'
  | 'supplier'
  | 'inactiveAdmin'
  | 'noProfile';
interface Fixture {
  users: Record<Actor, string>;
  order: string;
  invite: string;
  notification: string;
  buyerDocument: string;
  supplierDocument: string;
}

/** Synthetic records live only inside this transaction, even on assertion failure. */
async function scenario(run: (tx: postgres.TransactionSql, f: Fixture) => Promise<void>) {
  const sql = postgres(databaseUrl as string, { max: 1, prepare: false });
  const id = () => crypto.randomUUID();
  try {
    await sql
      .begin(async (tx) => {
        const runId = `E2E-${id()}-sensitive-records`;
        const buyer = id();
        const otherBuyer = id();
        const supplier = id();
        const users = Object.fromEntries(
          [
            'admin',
            'concierge',
            'buyer',
            'otherBuyer',
            'supplier',
            'inactiveAdmin',
            'noProfile',
          ].map((actor) => [actor, id()]),
        ) as Record<Actor, string>;
        const f: Fixture = {
          users,
          order: id(),
          invite: id(),
          notification: id(),
          buyerDocument: id(),
          supplierDocument: id(),
        };
        await tx`insert into companies(id, type, name) values
        (${buyer}, 'buyer', ${runId}), (${otherBuyer}, 'buyer', ${runId}), (${supplier}, 'supplier', ${runId})`;
        for (const [actor, user] of Object.entries(users)) {
          await tx`insert into auth.users(id, email) values (${user}, ${`${runId}-${actor}@example.test`})`;
          if (actor === 'noProfile') continue;
          const company =
            actor === 'buyer'
              ? buyer
              : actor === 'otherBuyer'
                ? otherBuyer
                : actor === 'supplier'
                  ? supplier
                  : null;
          const role =
            actor === 'admin' || actor === 'inactiveAdmin'
              ? 'admin'
              : actor === 'concierge'
                ? 'concierge'
                : 'owner';
          await tx`insert into public.users(id, company_id, role, full_name, email, is_active)
          values (${user}, ${company}, ${role}, ${runId}, ${`${runId}-${actor}@example.test`}, ${actor !== 'inactiveAdmin'})`;
        }
        const request = id();
        const item = id();
        const plan = id();
        const rfq = id();
        const quote = id();
        const quoteLine = id();
        await tx`insert into requests(id, buyer_company_id, created_by, title, raw_text)
        values (${request}, ${buyer}, ${users.buyer}, ${runId}, ${runId})`;
        await tx`insert into request_items(id, request_id, name, category, qty, unit)
        values (${item}, ${request}, ${runId}, 'merch', 1, 'шт')`;
        await tx`insert into plans(id, request_id, kind, total_supplier_kzt, delivery_kzt, commission_kzt,
        commission_base, total_kzt, supplier_count, explanation, status)
        values (${plan}, ${request}, 'recommended', 100000, 0, 23000, 'supplier_ex_delivery', 123000, 1, '{}', 'proposed')`;
        await tx`insert into orders(id, request_id, approved_plan_id, state, concierge_user_id)
        values (${f.order}, ${request}, ${plan}, 'plan_proposed', ${users.concierge})`;
        await tx`insert into rfqs(id, request_id, supplier_company_id, token)
        values (${rfq}, ${request}, ${supplier}, ${id()})`;
        await tx`insert into quotes(id, rfq_id) values (${quote}, ${rfq})`;
        await tx`insert into quote_lines(id, quote_id, request_item_id, unit_price_kzt, lead_time_days)
        values (${quoteLine}, ${quote}, ${item}, 100000, 2)`;
        await tx`insert into plan_lines(plan_id, request_item_id, supplier_company_id, quote_line_id, qty, line_total_kzt, commission_pct, commission_kzt)
        values (${plan}, ${item}, ${supplier}, ${quoteLine}, 1, 100000, 23, 23000)`;
        await tx`insert into outbox(id, kind, recipient, subject, body, payload) values
        (${f.invite}, 'company_owner_invite', ${`${runId}@example.test`}, ${runId}, 'Synthetic credential', '{"actionLink":"https://example.test/synthetic-invite"}'),
        (${f.notification}, 'rfq_revision_requested', ${`${runId}@example.test`}, ${runId}, 'Synthetic notification', '{}')`;
        await tx`insert into documents(id, order_id, stage, type, url, meta) values
        (${f.buyerDocument}, ${f.order}, 'estimated', 'prepay_invoice', '/synthetic-document', '{}'),
        (${f.supplierDocument}, ${f.order}, 'estimated', 'supplier_invoice', '/synthetic-document', '{}')`;
        await run(tx, f);
        throw rollback;
      })
      .catch((error) => {
        if (error !== rollback) throw error;
      });
  } finally {
    await sql.end();
  }
}

async function asUser(tx: postgres.TransactionSql, user: string) {
  await tx`set local role authenticated`;
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: user, role: 'authenticated' })}, true)`;
}

suite('credential-bearing outbox and buyer document isolation', () => {
  it.each<Actor>(['concierge', 'buyer', 'otherBuyer', 'supplier', 'inactiveAdmin', 'noProfile'])(
    '%s cannot read or modify an owner invite',
    async (actor) =>
      scenario(async (tx, f) => {
        await asUser(tx, f.users[actor]);
        expect(await tx`select * from outbox where id = ${f.invite}`).toHaveLength(0);
        expect(
          await tx`update outbox set kind = 'notification', body = 'tampered' where id = ${f.invite} returning id`,
        ).toHaveLength(0);
        await tx`reset role`;
        const [row] = await tx`select kind, body from outbox where id = ${f.invite}`;
        expect(row).toMatchObject({ kind: 'company_owner_invite', body: 'Synthetic credential' });
      }),
  );

  it('concierge cannot create an invite or convert a regular notification into one', async () =>
    scenario(async (tx, f) => {
      await asUser(tx, f.users.concierge);
      await expect(
        tx.savepoint(
          (sp) => sp`insert into outbox(kind, recipient, subject, body)
      values ('company_owner_invite', 'E2E-synthetic@example.test', 'Synthetic', 'Synthetic')`,
        ),
      ).rejects.toThrow(/row-level security/i);
      await expect(
        tx.savepoint(
          (sp) => sp`update outbox set kind = 'company_owner_invite'
      where id = ${f.notification}`,
        ),
      ).rejects.toThrow(/row-level security/i);
    }));

  it.each<Actor>(['admin', 'concierge'])('%s can operate regular notifications', async (actor) =>
    scenario(async (tx, f) => {
      await asUser(tx, f.users[actor]);
      expect(
        await tx`update outbox set status = 'failed' where id = ${f.notification} returning id`,
      ).toHaveLength(1);
    }),
  );

  it('admin and service_role retain invite access', async () =>
    scenario(async (tx, f) => {
      await asUser(tx, f.users.admin);
      expect(
        await tx`update outbox set status = 'failed' where id = ${f.invite} returning id`,
      ).toHaveLength(1);
      await tx`reset role`;
      await tx`set local role service_role`;
      expect(await tx`select body, payload from outbox where id = ${f.invite}`).toHaveLength(1);
    }));

  it('admin queues an invite and the worker claims and completes it', async () =>
    scenario(async (tx, f) => {
      const invite = crypto.randomUUID();
      const lease = `E2E-${invite}-lease`;
      await asUser(tx, f.users.admin);
      await tx`insert into outbox(id, kind, recipient, subject, body) values
        (${invite}, 'company_owner_invite', 'E2E-worker@example.test', 'Synthetic', 'Synthetic')`;
      await tx`reset role`;
      await tx`set local role service_role`;
      const claimed = await tx`select id from public.claim_outbox_batch(100, ${lease})`;
      expect(claimed.map((r) => r.id)).toContain(invite);
      const [done] =
        await tx`select public.complete_outbox(${invite}, ${lease}, 'E2E-provider') as ok`;
      expect(done?.ok).toBe(true);
      const [row] = await tx`select status from outbox where id = ${invite}`;
      expect(row?.status).toBe('sent');
    }));

  it('supplier can read its order but no buyer-facing documents', async () =>
    scenario(async (tx, f) => {
      await asUser(tx, f.users.supplier);
      expect(await tx`select id from orders where id = ${f.order}`).toHaveLength(1);
      expect(await tx`select * from documents where order_id = ${f.order}`).toHaveLength(0);
    }));

  it('buyer sees its invoice, not internal supplier invoices', async () =>
    scenario(async (tx, f) => {
      await asUser(tx, f.users.buyer);
      expect(
        (await tx`select id from documents where order_id = ${f.order}`).map((r) => r.id),
      ).toEqual([f.buyerDocument]);
    }));

  it.each<Actor>(['otherBuyer', 'inactiveAdmin', 'noProfile'])(
    '%s cannot read buyer documents',
    async (actor) =>
      scenario(async (tx, f) => {
        await asUser(tx, f.users[actor]);
        expect(await tx`select * from documents where order_id = ${f.order}`).toHaveLength(0);
      }),
  );

  it.each<Actor>(['admin', 'concierge'])('%s retains both document types', async (actor) =>
    scenario(async (tx, f) => {
      await asUser(tx, f.users[actor]);
      expect(await tx`select id from documents where order_id = ${f.order}`).toHaveLength(2);
    }),
  );
});
