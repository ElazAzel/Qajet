import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

/**
 * Изоляция вложений — qajet-master-spec.md §3.4 и ADR-0009.
 *
 * Раньше `attachments_select_supplier` открывал поставщику ВСЁ, что
 * привязано к заказу через `order_id`, а `attachments_select_buyer` —
 * всё, кроме `supplier_invoice`. В интерфейсе это выглядело так: на
 * странице заказа поставщика A в блоке «Вложения заказа» лежали счёт и
 * акт доставки поставщика B и платёжка покупателя (из неё видно, сколько
 * покупатель заплатил QAJET, то есть наценку), а покупатель видел файлы
 * поставщиков, хотя личность исполнителя от него скрыта.
 *
 * Каждый сценарий живёт в одной транзакции и откатывается целиком, даже
 * если ассерт упал: после теста в базе не остаётся ни одной строки.
 */

const databaseUrl = process.env.DATABASE_URL;
const describeIfConfigured = databaseUrl ? describe : describe.skip;
const rollback = new Error('fixture rollback');

type FileKey = 'aDelivery' | 'aQuoteFile' | 'bInvoice' | 'bDelivery' | 'buyerPrepay' | 'staffAct';

interface Fixture {
  order: string;
  buyerOwner: string;
  staff: string;
  supplierAOwner: string;
  supplierBOwner: string;
  files: Record<FileKey, { id: string; objectKey: string }>;
}

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
        const request = crypto.randomUUID();
        const item = crypto.randomUUID();
        const plan = crypto.randomUUID();
        const order = crypto.randomUUID();

        await tx`insert into companies (id, type, name) values
          (${buyer}, 'buyer', 'E2E-attachments buyer'),
          (${supplierA}, 'supplier', 'E2E-attachments supplier A'),
          (${supplierB}, 'supplier', 'E2E-attachments supplier B')`;
        await tx`insert into auth.users (id) values (${buyerOwner}), (${staff}), (${supplierAOwner}), (${supplierBOwner})`;
        await tx`insert into public.users (id, company_id, role, full_name, email) values
          (${buyerOwner}, ${buyer}, 'owner', 'Buyer', 'e2e-attachments-buyer@example.com'),
          (${staff}, null, 'concierge', 'Staff', 'e2e-attachments-staff@example.com'),
          (${supplierAOwner}, ${supplierA}, 'owner', 'Supplier A', 'e2e-attachments-a@example.com'),
          (${supplierBOwner}, ${supplierB}, 'owner', 'Supplier B', 'e2e-attachments-b@example.com')`;
        await tx`insert into requests (id, buyer_company_id, created_by, title, raw_text)
          values (${request}, ${buyer}, ${buyerOwner}, 'E2E-attachments', 'E2E-attachments')`;
        await tx`insert into request_items (id, request_id, name, category, qty, unit)
          values (${item}, ${request}, 'Item', 'merch', 10, 'шт')`;
        await tx`insert into plans (id, request_id, kind, total_supplier_kzt, delivery_kzt, commission_kzt, commission_base, total_kzt, supplier_count, explanation, status)
          values (${plan}, ${request}, 'recommended', 200000, 0, 46000, 'supplier_ex_delivery', 246000, 2, '{}', 'proposed')`;

        for (const supplier of [supplierA, supplierB]) {
          const rfq = crypto.randomUUID();
          const quote = crypto.randomUUID();
          const quoteLine = crypto.randomUUID();
          await tx`insert into rfqs (id, request_id, supplier_company_id, token)
            values (${rfq}, ${request}, ${supplier}, ${crypto.randomUUID()})`;
          await tx`insert into quotes (id, rfq_id) values (${quote}, ${rfq})`;
          await tx`insert into quote_lines (id, quote_id, request_item_id, unit_price_kzt, lead_time_days)
            values (${quoteLine}, ${quote}, ${item}, 10000, 2)`;
          await tx`insert into plan_lines (plan_id, request_item_id, supplier_company_id, quote_line_id, qty, line_total_kzt, commission_pct, commission_kzt)
            values (${plan}, ${item}, ${supplier}, ${quoteLine}, 10, 100000, 23, 23000)`;
        }
        await tx`insert into orders (id, request_id, approved_plan_id, state, concierge_user_id)
          values (${order}, ${request}, ${plan}, 'plan_proposed', ${staff})`;

        async function file(uploadedBy: string, kind: string) {
          const id = crypto.randomUUID();
          const objectKey = `${uploadedBy}/${crypto.randomUUID()}-${kind}.pdf`;
          await tx`insert into attachments (id, order_id, uploaded_by, object_key, file_name, content_type, size_bytes, kind)
            values (${id}, ${order}, ${uploadedBy}, ${objectKey}, ${`${kind}.pdf`}, 'application/pdf', 100, ${kind})`;
          return { id, objectKey };
        }
        const files: Fixture['files'] = {
          aDelivery: await file(supplierAOwner, 'delivery_proof'),
          aQuoteFile: await file(supplierAOwner, 'quote_file'),
          bInvoice: await file(supplierBOwner, 'supplier_invoice'),
          bDelivery: await file(supplierBOwner, 'delivery_proof'),
          buyerPrepay: await file(buyerOwner, 'prepay_proof'),
          staffAct: await file(staff, 'attachment'),
        };

        await run(tx, { order, buyerOwner, staff, supplierAOwner, supplierBOwner, files });
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

/** Видимые вызывающему вложения заказа — ровно тот запрос, что делает страница заказа. */
async function visibleAttachments(tx: postgres.TransactionSql, userId: string, orderId: string) {
  await impersonate(tx, userId);
  const rows = await tx<{ id: string }[]>`select id from attachments where order_id = ${orderId}`;
  await tx`reset role`;
  return new Set(rows.map((r) => r.id));
}

describeIfConfigured('изоляция вложений заказа (RLS)', () => {
  it('поставщик видит только файлы своей компании: не соседа и не платёжку покупателя', async () => {
    await scenario(async (tx, f) => {
      const seenByA = await visibleAttachments(tx, f.supplierAOwner, f.order);
      // Своё видно — иначе проверка изоляции прошла бы и при полной слепоте.
      expect(seenByA.has(f.files.aDelivery.id)).toBe(true);
      expect(seenByA.has(f.files.aQuoteFile.id)).toBe(true);
      expect(seenByA.has(f.files.bInvoice.id)).toBe(false);
      expect(seenByA.has(f.files.bDelivery.id)).toBe(false);
      expect(seenByA.has(f.files.buyerPrepay.id)).toBe(false);
      expect(seenByA.has(f.files.staffAct.id)).toBe(false);

      const seenByB = await visibleAttachments(tx, f.supplierBOwner, f.order);
      expect(seenByB.has(f.files.bInvoice.id)).toBe(true);
      expect(seenByB.has(f.files.aDelivery.id)).toBe(false);
      expect(seenByB.has(f.files.aQuoteFile.id)).toBe(false);
    });
  });

  it('покупатель видит свои файлы и документы QAJET, но не файлы поставщиков', async () => {
    await scenario(async (tx, f) => {
      const seen = await visibleAttachments(tx, f.buyerOwner, f.order);
      expect(seen.has(f.files.buyerPrepay.id)).toBe(true);
      expect(seen.has(f.files.staffAct.id)).toBe(true);
      expect(seen.has(f.files.aDelivery.id)).toBe(false);
      expect(seen.has(f.files.aQuoteFile.id)).toBe(false);
      expect(seen.has(f.files.bInvoice.id)).toBe(false);
      expect(seen.has(f.files.bDelivery.id)).toBe(false);
    });
  });

  it('консьерж видит все вложения заказа', async () => {
    await scenario(async (tx, f) => {
      const seen = await visibleAttachments(tx, f.staff, f.order);
      for (const file of Object.values(f.files)) expect(seen.has(file.id)).toBe(true);
    });
  });

  it('объект в Storage недоступен поставщику, если недоступна строка вложения', async () => {
    await scenario(async (tx, f) => {
      for (const file of Object.values(f.files)) {
        await tx`insert into storage.objects (bucket_id, name, owner_id) values ('qajet-docs', ${file.objectKey}, ${f.staff})`;
      }
      await impersonate(tx, f.supplierAOwner);
      const rows = await tx<
        { name: string }[]
      >`select name from storage.objects where bucket_id = 'qajet-docs'`;
      await tx`reset role`;
      const names = new Set(rows.map((r) => r.name));
      expect(names.has(f.files.aDelivery.objectKey)).toBe(true);
      expect(names.has(f.files.bInvoice.objectKey)).toBe(false);
      expect(names.has(f.files.buyerPrepay.objectKey)).toBe(false);
    });
  });
});
