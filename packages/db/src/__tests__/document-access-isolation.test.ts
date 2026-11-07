import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

/**
 * Real PostgreSQL document SELECT boundary. Order visibility is deliberately
 * broader than document visibility: both suppliers belong to the approved plan
 * and must retain their own order/line reads without receiving buyer documents.
 * All fixtures use an E2E-UUID namespace and roll back, including audit/outbox
 * side effects. No external worker is started and no shared rows are cleaned up.
 * INSERT tests preserve Document Engine compatibility, not document authenticity:
 * the existing broad buyer INSERT policy is outside this SELECT-only regression.
 */
const databaseUrl = process.env.DATABASE_URL;
const describeIfConfigured = databaseUrl ? describe : describe.skip;
const rollback = new Error('document-access-isolation fixture rollback');
const DOCUMENT_TYPES = [
  'prepay_invoice',
  'supplier_invoice',
  'act',
  'final_invoice',
  'refund_confirmation',
  'spec',
] as const;
type DocumentType = (typeof DOCUMENT_TYPES)[number];
const BUYER_TYPES = DOCUMENT_TYPES.filter((type) => type !== 'supplier_invoice');

interface DocumentFixture {
  id: string;
  type: DocumentType;
  url: string;
  meta: { privateCanary: string; nested: { amountKzt: number; recipient: string } };
}

interface OrderFixture {
  id: string;
  request: string;
  plan: string;
  supplierLines: [string, string];
  documents: DocumentFixture[];
}

interface World {
  namespace: string;
  buyerCompany: string;
  inactiveCompany: string;
  supplierCompanies: [string, string];
  owner: string;
  manager: string;
  foreignOwner: string;
  suppliers: [string, string];
  staff: string;
  admin: string;
  inactiveBuyer: string;
  inactiveManager: string;
  inactiveStaff: string;
  inactiveAdmin: string;
  inactiveCompanyOwner: string;
  missingProfile: string;
  own: OrderFixture;
  teammate: OrderFixture;
  foreign: OrderFixture;
  inactive: OrderFixture;
}

function orderFixture(namespace: string, label: string): OrderFixture {
  return {
    id: crypto.randomUUID(),
    request: crypto.randomUUID(),
    plan: crypto.randomUUID(),
    supplierLines: [crypto.randomUUID(), crypto.randomUUID()],
    documents: DOCUMENT_TYPES.map((type) => ({
      id: crypto.randomUUID(),
      type,
      url: `https://documents.example.test/${namespace}/${label}/${type}.pdf`,
      meta: {
        privateCanary: `${namespace}-${label}-${type}-confidential`,
        nested: { amountKzt: 246000, recipient: `${namespace}-${label}-buyer` },
      },
    })),
  };
}

async function scenario(run: (tx: postgres.TransactionSql, w: World) => Promise<void>) {
  const sql = postgres(databaseUrl as string, { max: 1, prepare: false });
  const id = () => crypto.randomUUID();
  try {
    await sql
      .begin(async (tx) => {
        const namespace = `E2E-${id()}-document-access-isolation`;
        const foreignCompany = id();
        const w: World = {
          namespace,
          buyerCompany: id(),
          inactiveCompany: id(),
          supplierCompanies: [id(), id()],
          owner: id(),
          manager: id(),
          foreignOwner: id(),
          suppliers: [id(), id()],
          staff: id(),
          admin: id(),
          inactiveBuyer: id(),
          inactiveManager: id(),
          inactiveStaff: id(),
          inactiveAdmin: id(),
          inactiveCompanyOwner: id(),
          missingProfile: id(),
          own: orderFixture(namespace, 'own'),
          teammate: orderFixture(namespace, 'teammate'),
          foreign: orderFixture(namespace, 'foreign'),
          inactive: orderFixture(namespace, 'inactive'),
        };
        await tx`insert into public.companies (id, type, name, is_active) values
          (${w.buyerCompany}, 'buyer', ${`${namespace}-buyer`}, true),
          (${foreignCompany}, 'buyer', ${`${namespace}-foreign`}, true),
          (${w.inactiveCompany}, 'buyer', ${`${namespace}-inactive`}, false),
          (${w.supplierCompanies[0]}, 'supplier', ${`${namespace}-supplier-a`}, true),
          (${w.supplierCompanies[1]}, 'supplier', ${`${namespace}-supplier-b`}, true)`;
        const users: [string, string | null, string, boolean][] = [
          [w.owner, w.buyerCompany, 'owner', true],
          [w.manager, w.buyerCompany, 'manager', true],
          [w.foreignOwner, foreignCompany, 'owner', true],
          [w.suppliers[0], w.supplierCompanies[0], 'owner', true],
          [w.suppliers[1], w.supplierCompanies[1], 'manager', true],
          [w.staff, null, 'concierge', true],
          [w.admin, null, 'admin', true],
          [w.inactiveBuyer, w.buyerCompany, 'owner', false],
          [w.inactiveManager, w.buyerCompany, 'manager', false],
          [w.inactiveStaff, null, 'concierge', false],
          [w.inactiveAdmin, null, 'admin', false],
          [w.inactiveCompanyOwner, w.inactiveCompany, 'owner', true],
        ];
        for (const [user, company, role, active] of users) {
          await tx`insert into auth.users (id) values (${user})`;
          await tx`insert into public.users
            (id, company_id, role, full_name, email, is_active)
            values (${user}, ${company}, ${role}, ${`${namespace}-${role}`},
              ${`${namespace}-${user}@example.test`}, ${active})`;
        }
        await tx`insert into auth.users (id) values (${w.missingProfile})`;

        for (const [order, company, creator] of [
          [w.own, w.buyerCompany, w.owner],
          [w.teammate, w.buyerCompany, w.manager],
          [w.foreign, foreignCompany, w.foreignOwner],
          [w.inactive, w.inactiveCompany, w.inactiveCompanyOwner],
        ] as [OrderFixture, string, string][]) {
          await tx`insert into public.requests
            (id, buyer_company_id, created_by, title, raw_text)
            values (${order.request}, ${company}, ${creator}, ${namespace}, ${namespace})`;
          await tx`insert into public.plans
            (id, request_id, version, kind, total_supplier_kzt, delivery_kzt,
             commission_kzt, commission_base, total_kzt, supplier_count, explanation, status)
            values (${order.plan}, ${order.request}, 1, 'recommended', 200000, 0,
              46000, 'supplier_ex_delivery', 246000, 2, '{}'::jsonb, 'approved')`;
          for (const index of [0, 1] as const) {
            const supplierCompany = w.supplierCompanies[index];
            const item = id();
            const rfq = id();
            const quote = id();
            const quoteLine = id();
            await tx`insert into public.request_items
              (id, request_id, name, category, qty, unit)
              values (${item}, ${order.request}, ${`${namespace}-item-${index}`}, 'merch', 10, 'шт')`;
            await tx`insert into public.rfqs
              (id, request_id, supplier_company_id, token, status, assigned_supplier_user_id)
              values (${rfq}, ${order.request}, ${supplierCompany}, ${id()}, 'sent',
                ${w.suppliers[index]})`;
            await tx`insert into public.quotes (id, rfq_id) values (${quote}, ${rfq})`;
            await tx`insert into public.quote_lines
              (id, quote_id, request_item_id, unit_price_kzt, lead_time_days)
              values (${quoteLine}, ${quote}, ${item}, 10000, 2)`;
            await tx`insert into public.plan_lines
              (id, plan_id, request_item_id, supplier_company_id, quote_line_id,
               qty, line_total_kzt, commission_pct, commission_kzt)
              values (${order.supplierLines[index]}, ${order.plan}, ${item}, ${supplierCompany},
                ${quoteLine}, 10, 100000, 23, 23000)`;
          }
          await tx`insert into public.orders
            (id, request_id, approved_plan_id, state, concierge_user_id)
            values (${order.id}, ${order.request}, ${order.plan}, 'plan_approved', ${w.staff})`;
          for (const document of order.documents) {
            await tx`insert into public.documents (id, order_id, stage, type, url, meta)
              values (${document.id}, ${order.id}, 'closed', ${document.type}, ${document.url},
                ${tx.json(document.meta)})`;
          }
        }
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

async function readDocuments(tx: postgres.TransactionSql, orders: OrderFixture[]) {
  return tx<{ payload: DocumentFixture & { order_id: string } }[]>`
    select to_jsonb(d) as payload from public.documents d
    where d.order_id = any(${tx.array(orders.map((order) => order.id))}::uuid[])`;
}

async function assertSupplierContext(tx: postgres.TransactionSql, w: World, index: 0 | 1) {
  await asUser(tx, w.suppliers[index]);
  expect(await tx`select id from public.orders where id = ${w.own.id}`).toEqual([{ id: w.own.id }]);
  expect(
    await tx`select id, supplier_company_id from public.plan_lines where plan_id = ${w.own.plan}`,
  ).toEqual([{ id: w.own.supplierLines[index], supplier_company_id: w.supplierCompanies[index] }]);
}

function buyerDocuments(orders: OrderFixture[]) {
  return orders.flatMap((order) => order.documents.filter((d) => d.type !== 'supplier_invoice'));
}

async function insertDocument(
  tx: postgres.TransactionSql,
  w: World,
  order: OrderFixture,
  type: DocumentType,
) {
  const id = crypto.randomUUID();
  const url = `https://documents.example.test/${w.namespace}/${id}.pdf`;
  const meta = { compatibilityCanary: `${w.namespace}-${id}` };
  const rows = await tx`
    insert into public.documents (id, order_id, stage, type, url, meta)
    values (${id}, ${order.id}, 'closed', ${type}, ${url}, ${tx.json(meta)})
    returning id, order_id, type, url, meta`;
  expect(rows).toEqual([{ id, order_id: order.id, type, url, meta }]);
}

describeIfConfigured('document access isolation: database boundary', () => {
  it.each([0, 1] as const)(
    'linked supplier %s retains its order and own line but no document type or JSON payload',
    async (index) => {
      await scenario(async (tx, w) => {
        await assertSupplierContext(tx, w, index);
        for (const document of w.own.documents) {
          expect(
            await tx`select to_jsonb(d) as payload from public.documents d where id = ${document.id}`,
          ).toHaveLength(0);
        }
        expect(await readDocuments(tx, [w.own, w.teammate, w.foreign])).toHaveLength(0);
      });
    },
  );

  it.each([0, 1] as const)(
    'linked supplier %s cannot recover documents through order/plan-line joins or JSON aggregates',
    async (index) => {
      await scenario(async (tx, w) => {
        await assertSupplierContext(tx, w, index);
        const rows = await tx`
          select o.id, coalesce(jsonb_agg(to_jsonb(d)) filter (where d.id is not null), '[]'::jsonb)
            as documents
          from public.orders o left join public.documents d on d.order_id = o.id
          where o.id = ${w.own.id} group by o.id`;
        expect(rows).toEqual([{ id: w.own.id, documents: [] }]);
        expect(
          await tx`select d.url, d.meta from public.plan_lines pl
            join public.orders o on o.approved_plan_id = pl.plan_id
            join public.documents d on d.order_id = o.id
            where pl.id = ${w.own.supplierLines[index]}`,
        ).toHaveLength(0);
      });
    },
  );

  it.each([
    ['owner', (w: World) => w.owner],
    ['manager', (w: World) => w.manager],
  ])(
    '%s reads all five buyer types company-wide, never supplier invoices or foreign rows',
    async (_label, actor) => {
      await scenario(async (tx, w) => {
        await asUser(tx, actor(w));
        const rows = await readDocuments(tx, [w.own, w.teammate, w.foreign, w.inactive]);
        const expected = buyerDocuments([w.own, w.teammate]);
        expect(rows.map((r) => r.payload.id).sort()).toEqual(expected.map((d) => d.id).sort());
        for (const document of expected) {
          expect(rows.find((r) => r.payload.id === document.id)?.payload).toMatchObject(document);
        }
        for (const order of [w.own, w.teammate]) {
          expect(
            rows
              .filter((r) => r.payload.order_id === order.id)
              .map((r) => r.payload.type)
              .sort(),
          ).toEqual([...BUYER_TYPES].sort());
          const privateDocument = order.documents.find((d) => d.type === 'supplier_invoice');
          if (!privateDocument) throw new Error('Fixture must include a supplier invoice');
          expect(
            await tx`select to_jsonb(d) from public.documents d where id = ${privateDocument.id}`,
          ).toHaveLength(0);
        }
      });
    },
  );

  it('foreign buyer reads its own buyer documents but no target document, including a known ID', async () => {
    await scenario(async (tx, w) => {
      await asUser(tx, w.foreignOwner);
      expect((await readDocuments(tx, [w.foreign])).map((r) => r.payload.id).sort()).toEqual(
        buyerDocuments([w.foreign])
          .map((d) => d.id)
          .sort(),
      );
      expect(await readDocuments(tx, [w.own, w.teammate])).toHaveLength(0);
      for (const document of w.own.documents) {
        expect(
          await tx`select url, meta from public.documents where id = ${document.id}`,
        ).toHaveLength(0);
      }
    });
  });

  it.each([
    ['concierge', (w: World) => w.staff],
    ['admin', (w: World) => w.admin],
  ])('%s retains every document type across buyer companies', async (_label, actor) => {
    await scenario(async (tx, w) => {
      await asUser(tx, actor(w));
      const orders = [w.own, w.teammate, w.foreign, w.inactive];
      const rows = await readDocuments(tx, orders);
      const documents = orders.flatMap((order) => order.documents);
      expect(rows.map((r) => r.payload.id).sort()).toEqual(documents.map((d) => d.id).sort());
      for (const document of documents) {
        expect(rows.find((r) => r.payload.id === document.id)?.payload).toMatchObject(document);
      }
    });
  });

  it('service_role retains every document type and INSERT RETURNING without a user profile', async () => {
    await scenario(async (tx, w) => {
      await tx`set local role service_role`;
      await tx`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`;
      const orders = [w.own, w.teammate, w.foreign, w.inactive];
      expect((await readDocuments(tx, orders)).map((r) => r.payload.id).sort()).toEqual(
        orders.flatMap((order) => order.documents.map((d) => d.id)).sort(),
      );
      await insertDocument(tx, w, w.foreign, 'supplier_invoice');
    });
  });

  it.each([
    ['inactive buyer owner', (w: World) => w.inactiveBuyer],
    ['inactive buyer manager', (w: World) => w.inactiveManager],
    ['inactive concierge', (w: World) => w.inactiveStaff],
    ['inactive admin', (w: World) => w.inactiveAdmin],
    ['missing profile', (w: World) => w.missingProfile],
    ['missing JWT subject', (_w: World) => null],
  ])('%s cannot read any document JSON', async (_label, actor) => {
    await scenario(async (tx, w) => {
      await asUser(tx, actor(w));
      expect(await readDocuments(tx, [w.own, w.teammate, w.foreign, w.inactive])).toHaveLength(0);
    });
  });

  it('active owner of an inactive buyer company cannot read its own documents', async () => {
    await scenario(async (tx, w) => {
      await asUser(tx, w.inactiveCompanyOwner);
      // These helpers validate the user, not company activity; company checking
      // must be part of the document authorization itself.
      expect(
        await tx`select public.current_role() as role, public.current_company_id() as company`,
      ).toEqual([{ role: 'owner', company: w.inactiveCompany }]);
      expect(await readDocuments(tx, [w.inactive])).toHaveLength(0);
    });
  });

  it('deactivating the buyer company revokes previously successful document reads', async () => {
    await scenario(async (tx, w) => {
      await asUser(tx, w.owner);
      expect(await readDocuments(tx, [w.own])).toHaveLength(5);
      await tx`reset role`;
      await tx`update public.companies set is_active = false where id = ${w.buyerCompany}`;
      await asUser(tx, w.owner);
      expect(await readDocuments(tx, [w.own, w.teammate])).toHaveLength(0);
    });
  });

  it('anon cannot read document rows or nested payloads', async () => {
    await scenario(async (tx, w) => {
      await tx`set local role anon`;
      await tx`select set_config('request.jwt.claims', '{}', true)`;
      expect(await readDocuments(tx, [w.own, w.foreign])).toHaveLength(0);
    });
  });

  it.each([
    ['owner', (w: World) => w.owner],
    ['manager', (w: World) => w.manager],
  ])(
    '%s preserves buyer Document Engine INSERT RETURNING on a teammate order',
    async (_label, actor) => {
      await scenario(async (tx, w) => {
        await asUser(tx, actor(w));
        const teammateOrder = actor(w) === w.owner ? w.teammate : w.own;
        for (const type of BUYER_TYPES) await insertDocument(tx, w, teammateOrder, type);
      });
    },
  );

  it.each([
    ['concierge', (w: World) => w.staff],
    ['admin', (w: World) => w.admin],
  ])(
    '%s preserves INSERT RETURNING for every type on a foreign buyer order',
    async (_label, actor) => {
      await scenario(async (tx, w) => {
        await asUser(tx, actor(w));
        for (const type of DOCUMENT_TYPES) await insertDocument(tx, w, w.foreign, type);
      });
    },
  );

  it.each([0, 1] as const)(
    'linked supplier %s still cannot insert buyer documents',
    async (index) => {
      await scenario(async (tx, w) => {
        await assertSupplierContext(tx, w, index);
        // No RETURNING: SELECT denial must not mask a broken INSERT policy.
        await expect(
          tx.savepoint(
            (sp) => sp`
            insert into public.documents (order_id, stage, type, url, meta)
            values (${w.own.id}, 'closed', 'act', ${`/documents/${w.namespace}`}, '{}'::jsonb)
          `,
          ),
        ).rejects.toThrow(/row-level security/);
      });
    },
  );

  it('foreign buyer still cannot insert a document into the target order', async () => {
    await scenario(async (tx, w) => {
      await asUser(tx, w.foreignOwner);
      await expect(
        tx.savepoint(
          (sp) => sp`
          insert into public.documents (order_id, stage, type, url, meta)
          values (${w.own.id}, 'closed', 'act', ${`/documents/${w.namespace}`}, '{}'::jsonb)
        `,
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });
});
