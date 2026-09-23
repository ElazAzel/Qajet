import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

/**
 * WhatsApp-номер поставщика — персональные данные (ADR-0011) и канал, через
 * который консьерж напоминает о RFQ. Номер видят только своя компания и
 * сотрудники QAJET: ни покупатель (личность поставщика от него скрыта, ADR-0009),
 * ни другой поставщик. Менять номер может только своя компания, и только в
 * формате +7XXXXXXXXXX.
 *
 * Каждый сценарий — одна транзакция, откатываемая целиком.
 */

const databaseUrl = process.env.DATABASE_URL;
const describeIfConfigured = databaseUrl ? describe : describe.skip;
const rollback = new Error('fixture rollback');

interface Fixture {
  supplierA: string;
  supplierAOwner: string;
  supplierBOwner: string;
  buyerOwner: string;
  staff: string;
}

const PHONE = '+77011234567';

async function scenario(run: (tx: postgres.TransactionSql, f: Fixture) => Promise<void>) {
  const sql = postgres(databaseUrl as string, { max: 1, prepare: false });
  try {
    await sql
      .begin(async (tx) => {
        const buyer = crypto.randomUUID();
        const supplierA = crypto.randomUUID();
        const supplierB = crypto.randomUUID();
        const buyerOwner = crypto.randomUUID();
        const staff = crypto.randomUUID();
        const supplierAOwner = crypto.randomUUID();
        const supplierBOwner = crypto.randomUUID();
        await tx`insert into companies (id, type, name) values
          (${buyer}, 'buyer', 'E2E-whatsapp buyer'),
          (${supplierA}, 'supplier', 'E2E-whatsapp supplier A'),
          (${supplierB}, 'supplier', 'E2E-whatsapp supplier B')`;
        await tx`insert into auth.users (id) values (${buyerOwner}), (${staff}), (${supplierAOwner}), (${supplierBOwner})`;
        await tx`insert into public.users (id, company_id, role, full_name, email) values
          (${buyerOwner}, ${buyer}, 'owner', 'Buyer', 'e2e-whatsapp-buyer@example.com'),
          (${staff}, null, 'concierge', 'Staff', 'e2e-whatsapp-staff@example.com'),
          (${supplierAOwner}, ${supplierA}, 'owner', 'Supplier A', 'e2e-whatsapp-a@example.com'),
          (${supplierBOwner}, ${supplierB}, 'owner', 'Supplier B', 'e2e-whatsapp-b@example.com')`;
        await tx`insert into supplier_profiles (company_id, whatsapp_phone) values
          (${supplierA}, ${PHONE}), (${supplierB}, null)`;
        await run(tx, { supplierA, supplierAOwner, supplierBOwner, buyerOwner, staff });
        throw rollback;
      })
      .catch((error) => {
        if (error !== rollback) throw error;
      });
  } finally {
    await sql.end();
  }
}

async function impersonate(tx: postgres.TransactionSql, userId: string) {
  await tx`set local role authenticated`;
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`;
}

async function phoneSeenBy(tx: postgres.TransactionSql, userId: string, companyId: string) {
  await impersonate(tx, userId);
  const rows = await tx<{ whatsapp_phone: string | null }[]>`
    select whatsapp_phone from supplier_profiles where company_id = ${companyId}`;
  await tx`reset role`;
  return rows.map((row) => row.whatsapp_phone);
}

describeIfConfigured('WhatsApp-номер поставщика (RLS)', () => {
  it('номер видят своя компания и консьерж, но не покупатель и не другой поставщик', async () => {
    await scenario(async (tx, f) => {
      expect(await phoneSeenBy(tx, f.supplierAOwner, f.supplierA)).toEqual([PHONE]);
      expect(await phoneSeenBy(tx, f.staff, f.supplierA)).toEqual([PHONE]);
      expect(await phoneSeenBy(tx, f.buyerOwner, f.supplierA)).toEqual([]);
      expect(await phoneSeenBy(tx, f.supplierBOwner, f.supplierA)).toEqual([]);
    });
  });

  it('другой поставщик не может переписать чужой номер', async () => {
    await scenario(async (tx, f) => {
      await impersonate(tx, f.supplierBOwner);
      const changed = await tx`
        update supplier_profiles set whatsapp_phone = '+77770000000'
        where company_id = ${f.supplierA} returning company_id`;
      await tx`reset role`;
      expect(changed).toHaveLength(0);
      const [row] = await tx<{ whatsapp_phone: string }[]>`
        select whatsapp_phone from supplier_profiles where company_id = ${f.supplierA}`;
      expect(row?.whatsapp_phone).toBe(PHONE);
    });
  });

  it('база принимает только формат +7XXXXXXXXXX', async () => {
    await scenario(async (tx, f) => {
      for (const bad of ['87011234567', '+7 701 123 45 67', '+1234567890', '+770112345678']) {
        await tx`savepoint bad_phone`;
        await expect(
          tx`update supplier_profiles set whatsapp_phone = ${bad} where company_id = ${f.supplierA}`,
        ).rejects.toThrow(/supplier_profiles_whatsapp_phone_format/);
        await tx`rollback to savepoint bad_phone`;
      }
    });
  });
});
