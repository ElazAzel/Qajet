import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

/**
 * Run only against an explicitly named local/test database via test:rls.
 * Every fixture is synthetic, transaction-local, and rolled back. In particular,
 * outbox records can never be committed or picked up by a notification worker.
 * A NULL role must be denied before the SECURITY DEFINER RPC changes an RFQ.
 */
const databaseUrl = process.env.DATABASE_URL;
const describeIfConfigured = databaseUrl ? describe : describe.skip;
const rollback = new Error('quote revision fixture rollback');
const denial = 'Запросить исправление КП может только сотрудник QAJET';
const note = 'Уточните срок производства';

type Actor =
  | 'concierge'
  | 'admin'
  | 'inactiveConcierge'
  | 'inactiveAdmin'
  | 'missingProfile'
  | 'buyerOwner'
  | 'buyerManager'
  | 'supplierOwner'
  | 'supplierManager';

interface World {
  actors: Record<Actor, string>;
  rfq: string;
  supplierEmail: string;
}

async function scenario(run: (tx: postgres.TransactionSql, world: World) => Promise<void>) {
  const sql = postgres(databaseUrl as string, { max: 1, prepare: false });
  const id = () => crypto.randomUUID();
  const prefix = `E2E-${id()}-quote-revision`;
  try {
    await sql
      .begin(async (tx) => {
        const buyer = id();
        const supplier = id();
        const request = id();
        const actors: Record<Actor, string> = {
          concierge: id(),
          admin: id(),
          inactiveConcierge: id(),
          inactiveAdmin: id(),
          missingProfile: id(),
          buyerOwner: id(),
          buyerManager: id(),
          supplierOwner: id(),
          supplierManager: id(),
        };
        const world: World = {
          actors,
          rfq: id(),
          supplierEmail: `${prefix}-supplierOwner@example.test`,
        };
        await tx`insert into public.companies (id, type, name) values
          (${buyer}, 'buyer', ${`${prefix}-buyer`}),
          (${supplier}, 'supplier', ${`${prefix}-supplier`})`;
        const profiles: [Actor, string | null, string, boolean][] = [
          ['concierge', null, 'concierge', true],
          ['admin', null, 'admin', true],
          ['inactiveConcierge', null, 'concierge', false],
          ['inactiveAdmin', null, 'admin', false],
          ['buyerOwner', buyer, 'owner', true],
          ['buyerManager', buyer, 'manager', true],
          ['supplierOwner', supplier, 'owner', true],
          ['supplierManager', supplier, 'manager', true],
        ];
        for (const [actor, userId] of Object.entries(actors)) {
          await tx`insert into auth.users (id, email)
            values (${userId}, ${`${prefix}-${actor}@example.test`})`;
        }
        for (const [actor, company, role, active] of profiles) {
          await tx`insert into public.users (id, company_id, role, full_name, email, is_active)
            values (${actors[actor]}, ${company}, ${role}, ${`${prefix}-${actor}`},
              ${`${prefix}-${actor}@example.test`}, ${active})`;
        }
        // missingProfile has a real auth identity, deliberately no public.users row.
        await tx`insert into public.requests
          (id, buyer_company_id, created_by, title, raw_text)
          values (${request}, ${buyer}, ${actors.buyerOwner}, ${prefix}, ${prefix})`;
        await tx`insert into public.rfqs
          (id, request_id, supplier_company_id, token, status, assigned_supplier_user_id)
          values (${world.rfq}, ${request}, ${supplier}, ${id()}, 'quoted',
            ${actors.supplierOwner})`;
        await tx`insert into public.quotes (id, rfq_id, version)
          values (${id()}, ${world.rfq}, 1)`;
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

async function asActor(tx: postgres.TransactionSql, userId: string | null) {
  await tx`reset role`;
  await tx`set local role authenticated`;
  // Clear both claim formats so a connection cannot retain a prior subject.
  await tx`select set_config('request.jwt.claim.sub', '', true)`;
  await tx`select set_config('request.jwt.claims',
    ${JSON.stringify({ ...(userId ? { sub: userId } : {}), role: 'authenticated' })}, true)`;
}

async function state(tx: postgres.TransactionSql, rfq: string) {
  await tx`reset role`;
  const [row] = await tx`select revision_requested, revision_note, updated_at
    from public.rfqs where id = ${rfq}`;
  const outbox = await tx`select id, recipient, payload, idempotency_key
    from public.outbox where payload->>'rfqId' = ${rfq} order by id`;
  return { row, outbox: [...outbox] };
}

describeIfConfigured('request_supplier_quote_revision: fail-closed authorization', () => {
  it.each(['inactiveConcierge', 'inactiveAdmin', 'missingProfile'] as const)(
    '%s: NULL role is rejected with no RFQ or outbox changes',
    async (actor) => {
      await scenario(async (tx, world) => {
        const before = await state(tx, world.rfq);
        await asActor(tx, world.actors[actor]);
        const [identity] = await tx`select auth.uid() as id, public.current_role() as role`;
        expect(identity?.id).toBe(world.actors[actor]);
        expect(identity?.role).toBeNull();
        await expect(
          tx.savepoint((sp) =>
            sp`select public.request_supplier_quote_revision(${world.rfq}, ${note})`,
          ),
        ).rejects.toThrow(denial);
        expect(await state(tx, world.rfq)).toEqual(before);
      });
    },
  );

  it.each(['buyerOwner', 'buyerManager', 'supplierOwner', 'supplierManager'] as const)(
    '%s: an active non-staff profile is rejected without side effects',
    async (actor) => {
      await scenario(async (tx, world) => {
        const before = await state(tx, world.rfq);
        await asActor(tx, world.actors[actor]);
        await expect(
          tx.savepoint((sp) =>
            sp`select public.request_supplier_quote_revision(${world.rfq}, ${note})`,
          ),
        ).rejects.toThrow(denial);
        expect(await state(tx, world.rfq)).toEqual(before);
      });
    },
  );

  it('authenticated without a JWT subject is rejected without side effects', async () => {
    await scenario(async (tx, world) => {
      const before = await state(tx, world.rfq);
      await asActor(tx, null);
      const [identity] = await tx`select auth.uid() as id`;
      expect(identity?.id).toBeNull();
      await expect(
        tx.savepoint((sp) =>
          sp`select public.request_supplier_quote_revision(${world.rfq}, ${note})`,
        ),
      ).rejects.toThrow(denial);
      expect(await state(tx, world.rfq)).toEqual(before);
    });
  });

  it('anon cannot execute the RPC and cannot change RFQ or outbox', async () => {
    await scenario(async (tx, world) => {
      const before = await state(tx, world.rfq);
      await asActor(tx, null);
      await tx`set local role anon`;
      await expect(
        tx.savepoint((sp) =>
          sp`select public.request_supplier_quote_revision(${world.rfq}, ${note})`,
        ),
      ).rejects.toThrow(/permission denied/);
      expect(await state(tx, world.rfq)).toEqual(before);
    });
  });

  it.each(['concierge', 'admin'] as const)(
    '%s: the authorized call and its retry retain transactional/idempotent behavior',
    async (actor) => {
      await scenario(async (tx, world) => {
        await asActor(tx, world.actors[actor]);
        await tx`select public.request_supplier_quote_revision(${world.rfq}, ${note})`;
        await tx`select public.request_supplier_quote_revision(${world.rfq}, ${note})`;
        const after = await state(tx, world.rfq);
        expect(after.row?.revision_requested).toBe(true);
        expect(after.row?.revision_note).toBe(note);
        expect(after.outbox).toHaveLength(1);
        expect(after.outbox[0]?.recipient).toBe(world.supplierEmail);
        expect(after.outbox[0]?.payload).toMatchObject({
          rfqId: world.rfq,
          note,
          quoteVersion: 2,
        });
        expect(after.outbox[0]?.idempotency_key).toBe(
          `rfq-revision:${world.rfq}:2:${world.actors.supplierOwner}`,
        );
      });
    },
  );

  it('effective function remains definer, hardened, and unavailable to PUBLIC/anon', async () => {
    await scenario(async (tx) => {
      const [row] = await tx`select p.prosecdef, p.proconfig,
        has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
        exists (
          select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where a.grantee = 0 and a.privilege_type = 'EXECUTE'
        ) as public_execute
        from pg_proc p
        where p.oid = 'public.request_supplier_quote_revision(uuid,text)'::regprocedure`;
      expect(row?.prosecdef).toBe(true);
      expect(row?.proconfig).toContain('search_path=""');
      expect(row?.anon_execute).toBe(false);
      expect(row?.public_execute).toBe(false);
      expect(row?.authenticated_execute).toBe(true);
    });
  });
});
