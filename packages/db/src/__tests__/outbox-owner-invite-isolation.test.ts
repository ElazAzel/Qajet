import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

/** Synthetic transaction-local fixtures only. No Auth links are generated or sent. */
const databaseUrl = process.env.DATABASE_URL;
const describeIfConfigured = databaseUrl ? describe : describe.skip;
const rollback = new Error('outbox invitation fixture rollback');
type Tx = postgres.TransactionSql;
type Actor =
  | 'admin'
  | 'concierge'
  | 'inactiveAdmin'
  | 'inactiveConcierge'
  | 'buyer'
  | 'supplier'
  | 'missing';
interface World {
  actors: Record<Actor, string>;
  invitation: string;
  routine: string;
  link: string;
}

async function scenario(run: (tx: Tx, world: World) => Promise<void>) {
  const sql = postgres(databaseUrl as string, { max: 1, prepare: false });
  const id = () => crypto.randomUUID();
  try {
    await sql
      .begin(async (tx) => {
        const prefix = `E2E-${id()}-outbox-invite`;
        const buyer = id();
        const supplier = id();
        const world: World = {
          actors: {
            admin: id(),
            concierge: id(),
            inactiveAdmin: id(),
            inactiveConcierge: id(),
            buyer: id(),
            supplier: id(),
            missing: id(),
          },
          invitation: id(),
          routine: id(),
          link: `https://example.invalid/synthetic-invite/${id()}`,
        };
        await tx`insert into companies (id, type, name) values
        (${buyer}, 'buyer', ${`${prefix}-buyer`}), (${supplier}, 'supplier', ${`${prefix}-supplier`})`;
        for (const [name, uid] of Object.entries(world.actors)) {
          await tx`insert into auth.users (id, email) values (${uid}, ${`${prefix}-${name}@example.test`})`;
          if (name === 'missing') continue;
          const company = name === 'buyer' ? buyer : name === 'supplier' ? supplier : null;
          const role =
            name === 'admin' || name === 'inactiveAdmin'
              ? 'admin'
              : name === 'concierge' || name === 'inactiveConcierge'
                ? 'concierge'
                : 'owner';
          await tx`insert into public.users (id, company_id, role, full_name, email, is_active)
          values (${uid}, ${company}, ${role}, ${prefix}, ${`${prefix}-${name}@example.test`}, ${!name.startsWith('inactive')})`;
        }
        await tx`insert into outbox (id, kind, recipient, subject, body, payload, status) values
        (${world.invitation}, 'company_owner_invite', 'owner@example.test', ${prefix}, ${`Synthetic invite: ${world.link}`},
          ${tx.json({ actionLink: world.link })}, 'failed'),
        (${world.routine}, 'rfq_invitation', 'supplier@example.test', ${prefix}, 'Synthetic RFQ', '{}', 'failed')`;
        await run(tx, world);
        throw rollback;
      })
      .catch((error) => {
        if (error !== rollback) throw error;
      });
  } finally {
    await sql.end();
  }
}
async function actor(tx: Tx, uid: string) {
  await tx`reset role`;
  await tx`set local role authenticated`;
  await tx`select set_config('request.jwt.claim.sub', '', true)`;
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: 'authenticated' })}, true)`;
}
async function ownerState(tx: Tx, id: string) {
  await tx`reset role`;
  const [row] = await tx`select * from outbox where id = ${id}`;
  return row;
}

describeIfConfigured('outbox: owner invitations are admin/service only', () => {
  it('concierge cannot read invite body or payload even when it knows the row id', () =>
    scenario(async (tx, w) => {
      await actor(tx, w.actors.concierge);
      const rows =
        await tx`select id, body, payload from outbox where id in (${w.invitation}, ${w.routine})`;
      expect(rows.map((r) => r.id)).toEqual([w.routine]);
      expect(JSON.stringify(rows)).not.toContain(w.link);
    }));

  it.each(['recipient', 'kind', 'body', 'payload', 'status'] as const)(
    'concierge cannot change an invitation %s',
    (field) =>
      scenario(async (tx, w) => {
        const before = await ownerState(tx, w.invitation);
        await actor(tx, w.actors.concierge);
        const assignments = {
          recipient: () =>
            tx`update outbox set recipient = 'redirect@example.test' where id = ${w.invitation} returning id`,
          kind: () =>
            tx`update outbox set kind = 'rfq_invitation' where id = ${w.invitation} returning id`,
          body: () =>
            tx`update outbox set body = 'Rewritten' where id = ${w.invitation} returning id`,
          payload: () =>
            tx`update outbox set payload = '{}' where id = ${w.invitation} returning id`,
          status: () =>
            tx`update outbox set status = 'pending' where id = ${w.invitation} returning id`,
        };
        expect(await assignments[field]()).toHaveLength(0);
        expect(await ownerState(tx, w.invitation)).toEqual(before);
      }),
  );

  it('concierge cannot insert a new owner invitation', () =>
    scenario(async (tx, w) => {
      await actor(tx, w.actors.concierge);
      await expect(
        tx.savepoint(
          (sp) => sp`insert into outbox (kind, recipient, subject, body)
      values ('company_owner_invite', 'owner@example.test', 'Synthetic', 'Synthetic')`,
        ),
      ).rejects.toThrow(/row-level security/);
    }));

  it('concierge cannot promote a visible routine row into an owner invitation', () =>
    scenario(async (tx, w) => {
      const before = await ownerState(tx, w.routine);
      await actor(tx, w.actors.concierge);
      await expect(
        tx.savepoint(
          (sp) => sp`update outbox set kind = 'company_owner_invite'
      where id = ${w.routine}`,
        ),
      ).rejects.toThrow(/row-level security/);
      expect(await ownerState(tx, w.routine)).toEqual(before);
    }));

  it('concierge cannot use upsert to relabel or redirect an existing invitation', () =>
    scenario(async (tx, w) => {
      const before = await ownerState(tx, w.invitation);
      await actor(tx, w.actors.concierge);
      await expect(
        tx.savepoint(
          (sp) => sp`insert into outbox (id, kind, recipient, subject, body)
      values (${w.invitation}, 'rfq_invitation', 'redirect@example.test', 'Synthetic', 'Synthetic')
      on conflict (id) do update set kind = excluded.kind, recipient = excluded.recipient`,
        ),
      ).rejects.toThrow(/row-level security/);
      expect(await ownerState(tx, w.invitation)).toEqual(before);
    }));

  it('concierge retains routine RFQ read/insert/update and retry', () =>
    scenario(async (tx, w) => {
      await actor(tx, w.actors.concierge);
      expect(await tx`select id from outbox where id = ${w.routine}`).toHaveLength(1);
      expect(
        await tx`update outbox set status = 'pending', last_error = null where id = ${w.routine} returning id`,
      ).toHaveLength(1);
      expect(
        await tx`insert into outbox (kind, recipient, subject, body)
      values ('rfq_revision_requested', 'supplier@example.test', 'Synthetic', 'Synthetic') returning id`,
      ).toHaveLength(1);
    }));

  it('active admin retains invitation read/insert/update and retry', () =>
    scenario(async (tx, w) => {
      await actor(tx, w.actors.admin);
      const [row] = await tx`select body, payload from outbox where id = ${w.invitation}`;
      expect(row?.payload.actionLink).toBe(w.link);
      expect(row?.body).toContain(w.link);
      expect(
        await tx`update outbox set status = 'pending', last_error = null where id = ${w.invitation} returning id`,
      ).toHaveLength(1);
      expect(
        await tx`insert into outbox (kind, recipient, subject, body)
      values ('company_owner_invite', 'owner@example.test', 'Synthetic', 'Synthetic') returning id`,
      ).toHaveLength(1);
    }));

  it.each(['inactiveAdmin', 'inactiveConcierge', 'buyer', 'supplier', 'missing'] as const)(
    '%s cannot read or change invitations',
    (name) =>
      scenario(async (tx, w) => {
        const before = await ownerState(tx, w.invitation);
        await actor(tx, w.actors[name]);
        expect(await tx`select id from outbox where id = ${w.invitation}`).toHaveLength(0);
        expect(
          await tx`update outbox set recipient = 'redirect@example.test' where id = ${w.invitation} returning id`,
        ).toHaveLength(0);
        await expect(
          tx.savepoint(
            (sp) => sp`insert into outbox (kind, recipient, subject, body)
        values ('company_owner_invite', 'owner@example.test', 'Synthetic', 'Synthetic')`,
          ),
        ).rejects.toThrow(/row-level security/);
        expect(await ownerState(tx, w.invitation)).toEqual(before);
      }),
  );

  it('anonymous role cannot read invitations', () =>
    scenario(async (tx, w) => {
      await tx`set local role anon`;
      expect(await tx`select id from outbox where id = ${w.invitation}`).toHaveLength(0);
    }));

  it('service worker still inserts, claims and completes invitations', () =>
    scenario(async (tx, w) => {
      await tx`set local role service_role`;
      expect(await tx`select id from outbox where id = ${w.invitation}`).toHaveLength(1);
      await tx`update outbox set status = 'pending', available_at = now() where id = ${w.invitation}`;
      const inserted = await tx`insert into outbox (kind, recipient, subject, body, status)
      values ('company_owner_invite', 'owner@example.test', 'Synthetic', 'Synthetic', 'sent') returning id`;
      expect(inserted).toHaveLength(1);
      // claim_outbox_batch is global. Refuse a populated/shared test queue
      // before claiming anything; only this scenario's invitation is eligible.
      await tx`update outbox set available_at = now() + interval '1 day' where id = ${w.routine}`;
      const others = await tx`select id from outbox where id <> ${w.invitation} and (
        (status in ('pending', 'failed') and available_at <= now())
        or (status = 'processing' and leased_until < now())
      )`;
      expect(others, 'worker test requires an isolated queue').toHaveLength(0);
      const lease = crypto.randomUUID();
      const claimed = await tx`select * from public.claim_outbox_batch(1, ${lease})`;
      expect(claimed.map((r) => r.id)).toContain(w.invitation);
      expect(claimed.find((r) => r.id === w.invitation)?.payload.actionLink).toBe(w.link);
      await tx`select public.complete_outbox(${w.invitation}, ${lease}, 'synthetic-provider-id')`;
      const [after] = await tx`select status from outbox where id = ${w.invitation}`;
      expect(after?.status).toBe('sent');
    }));

  it.each(['concierge', 'admin'] as const)('%s cannot bypass RLS via worker claim RPC', (name) =>
    scenario(async (tx, w) => {
      await actor(tx, w.actors[name]);
      await expect(
        tx.savepoint((sp) => sp`select * from public.claim_outbox_batch(10, 'synthetic-lease')`),
      ).rejects.toThrow(/permission denied for function/);
    }),
  );
});
