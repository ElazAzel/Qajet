import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

/**
 * Закрытие заказа с возвратом — qajet-master-spec.md §7.7: «оба исхода закрытия
 * реализуются сразу».
 *
 * Найдено сквозным прогоном: после подтверждения возврата консьержем покупатель
 * не мог закрыть заказ («Сначала подтвердите возврат на … ₸»), хотя факт возврата
 * был записан. Закрытие считает сверку по подтверждённым платежам, которые
 * читает под сессией покупателя, а политика `payment_facts_select_buyer_own`
 * пропускала только входящие. Возврат — исходящий платёж, поэтому покупатель
 * его не видел, считал возвращённое нулём и требовал возврат заново.
 *
 * Выплаты поставщикам остаются скрытыми: ADR-0009 не раскрывает покупателю ни
 * исполнителя, ни его цену.
 */

const databaseUrl = process.env.DATABASE_URL;
const describeIfConfigured = databaseUrl ? describe : describe.skip;
const rollback = new Error('fixture rollback');

interface Fixture {
  buyerOwner: string;
  otherBuyerOwner: string;
  staff: string;
  order: string;
}

async function scenario(run: (tx: postgres.TransactionSql, f: Fixture) => Promise<void>) {
  const sql = postgres(databaseUrl as string, { max: 1, prepare: false });
  try {
    await sql
      .begin(async (tx) => {
        const id = () => crypto.randomUUID();
        const buyer = id();
        const otherBuyer = id();
        const supplier = id();
        const request = id();
        const plan = id();
        const f: Fixture = {
          buyerOwner: id(),
          otherBuyerOwner: id(),
          staff: id(),
          order: id(),
        };
        await tx`insert into companies (id, type, name) values
          (${buyer}, 'buyer', 'E2E-refund buyer'), (${otherBuyer}, 'buyer', 'E2E-refund other'),
          (${supplier}, 'supplier', 'E2E-refund supplier')`;
        await tx`insert into auth.users (id) values (${f.buyerOwner}), (${f.otherBuyerOwner}), (${f.staff})`;
        await tx`insert into public.users (id, company_id, role, full_name, email) values
          (${f.buyerOwner}, ${buyer}, 'owner', 'Buyer', 'e2e-refund-buyer@example.com'),
          (${f.otherBuyerOwner}, ${otherBuyer}, 'owner', 'Other', 'e2e-refund-other@example.com'),
          (${f.staff}, null, 'concierge', 'Staff', 'e2e-refund-staff@example.com')`;
        await tx`insert into requests (id, buyer_company_id, created_by, title, raw_text)
          values (${request}, ${buyer}, ${f.buyerOwner}, 'E2E-refund', 'E2E-refund')`;
        await tx`insert into plans (id, request_id, kind, total_supplier_kzt, delivery_kzt, commission_kzt, commission_base, total_kzt, supplier_count, explanation, status)
          values (${plan}, ${request}, 'recommended', 0, 0, 0, 'supplier_ex_delivery', 0, 0, '{}', 'draft')`;
        await tx`insert into orders (id, request_id, approved_plan_id, state, concierge_user_id)
          values (${f.order}, ${request}, ${plan}, 'accepted', ${f.staff})`;
        // Факты пишутся владельцем базы: проверяется только видимость, не путь записи.
        await tx`insert into payment_facts (order_id, direction, kind, status, amount_kzt, reference, confirmed_by, idempotency_key)
          values (${f.order}, 'inbound', 'prepayment', 'confirmed', 1000, 'ref-in', ${f.staff}, ${`refund-in-${id()}`})`;
        await tx`insert into payment_facts (order_id, direction, kind, status, amount_kzt, reference, confirmed_by, idempotency_key)
          values (${f.order}, 'outbound', 'refund', 'confirmed', 400, 'ref-refund', ${f.staff}, ${`refund-out-${id()}`})`;
        await tx`insert into payment_facts (order_id, supplier_company_id, direction, kind, status, amount_kzt, reference, confirmed_by, idempotency_key)
          values (${f.order}, ${supplier}, 'outbound', 'supplier_payout', 'confirmed', 500, 'ref-payout', ${f.staff}, ${`refund-payout-${id()}`})`;
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

async function kindsSeenBy(tx: postgres.TransactionSql, userId: string, order: string) {
  await tx`set local role authenticated`;
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`;
  const rows = await tx<
    { kind: string }[]
  >`select kind from payment_facts where order_id = ${order}`;
  await tx`reset role`;
  return rows.map((r) => r.kind).sort();
}

describeIfConfigured('видимость платежей для сверки при закрытии', () => {
  it('покупатель видит свою предоплату и возврат, но не выплаты поставщикам', async () =>
    scenario(async (tx, f) => {
      expect(await kindsSeenBy(tx, f.buyerOwner, f.order)).toEqual(['prepayment', 'refund']);
    }));

  it('чужой покупатель не видит платежей этого заказа', async () =>
    scenario(async (tx, f) => {
      expect(await kindsSeenBy(tx, f.otherBuyerOwner, f.order)).toEqual([]);
    }));

  it('консьерж видит все факты', async () =>
    scenario(async (tx, f) => {
      expect(await kindsSeenBy(tx, f.staff, f.order)).toEqual([
        'prepayment',
        'refund',
        'supplier_payout',
      ]);
    }));
});
