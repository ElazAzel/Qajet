import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

/**
 * Прямая запись в orders и подтверждение доставки — qajet-master-spec.md §6, §3.4.
 *
 * Приложение не пишет в `orders` напрямую, но PostgREST даёт это любой
 * сессии с таблицей `orders` в схеме `public`. Поэтому защита обязана жить
 * в базе, и здесь она проверяется тем же путём, каким её обошёл бы
 * злоумышленник: прямой `update orders` под ролью `authenticated`.
 *
 * Воспроизведённые дефекты (до миграции 0041):
 *  - консьерж переписывает `final_cost_kzt` / `settlement` закрытого заказа:
 *    guard_order_actor выходит сразу при OLD.state = NEW.state, а аудит
 *    висит на `UPDATE OF state`, то есть след не остаётся;
 *  - покупатель проставляет `accepted_at` произвольной датой;
 *  - неназначенный менеджер поставщика подтверждает доставку чужого заказа.
 *
 * Каждый сценарий откатывается целиком, в том числе при падении ассерта.
 */

const databaseUrl = process.env.DATABASE_URL;
const describeIfConfigured = databaseUrl ? describe : describe.skip;
const rollback = new Error('fixture rollback');

interface Fixture {
  buyer: string;
  supplier: string;
  buyerOwner: string;
  staff: string;
  supplierOwner: string;
  supplierManager: string;
  request: string;
  item: string;
  rfq: string;
  plan: string;
  order: string;
}

async function scenario(run: (tx: postgres.TransactionSql, f: Fixture) => Promise<void>) {
  const sql = postgres(databaseUrl as string, { max: 1, prepare: false });
  try {
    await sql
      .begin(async (tx) => {
        const f: Fixture = {
          buyer: crypto.randomUUID(),
          supplier: crypto.randomUUID(),
          buyerOwner: crypto.randomUUID(),
          staff: crypto.randomUUID(),
          supplierOwner: crypto.randomUUID(),
          supplierManager: crypto.randomUUID(),
          request: crypto.randomUUID(),
          item: crypto.randomUUID(),
          rfq: crypto.randomUUID(),
          plan: crypto.randomUUID(),
          order: crypto.randomUUID(),
        };
        await tx`insert into companies (id, type, name) values
          (${f.buyer}, 'buyer', 'E2E-guard buyer'), (${f.supplier}, 'supplier', 'E2E-guard supplier')`;
        await tx`insert into auth.users (id) values (${f.buyerOwner}), (${f.staff}), (${f.supplierOwner}), (${f.supplierManager})`;
        await tx`insert into public.users (id, company_id, role, full_name, email) values
          (${f.buyerOwner}, ${f.buyer}, 'owner', 'Buyer', 'e2e-guard-buyer@example.com'),
          (${f.staff}, null, 'concierge', 'Staff', 'e2e-guard-staff@example.com'),
          (${f.supplierOwner}, ${f.supplier}, 'owner', 'Supplier owner', 'e2e-guard-owner@example.com'),
          (${f.supplierManager}, ${f.supplier}, 'manager', 'Supplier manager', 'e2e-guard-manager@example.com')`;
        await tx`insert into requests (id, buyer_company_id, created_by, title, raw_text)
          values (${f.request}, ${f.buyer}, ${f.buyerOwner}, 'E2E-guard', 'E2E-guard')`;
        await tx`insert into request_items (id, request_id, name, category, qty, unit)
          values (${f.item}, ${f.request}, 'Item', 'merch', 10, 'шт')`;
        await tx`insert into rfqs (id, request_id, supplier_company_id, token)
          values (${f.rfq}, ${f.request}, ${f.supplier}, ${crypto.randomUUID()})`;
        await tx`insert into plans (id, request_id, kind, total_supplier_kzt, delivery_kzt, commission_kzt, commission_base, total_kzt, supplier_count, explanation, status)
          values (${f.plan}, ${f.request}, 'recommended', 100000, 0, 23000, 'supplier_ex_delivery', 123000, 1, '{}', 'proposed')`;
        const quote = crypto.randomUUID();
        const quoteLine = crypto.randomUUID();
        await tx`insert into quotes (id, rfq_id) values (${quote}, ${f.rfq})`;
        await tx`insert into quote_lines (id, quote_id, request_item_id, unit_price_kzt, lead_time_days)
          values (${quoteLine}, ${quote}, ${f.item}, 10000, 2)`;
        await tx`insert into plan_lines (plan_id, request_item_id, supplier_company_id, quote_line_id, qty, line_total_kzt, commission_pct, commission_kzt)
          values (${f.plan}, ${f.item}, ${f.supplier}, ${quoteLine}, 10, 100000, 23, 23000)`;
        await tx`insert into orders (id, request_id, approved_plan_id, state, concierge_user_id)
          values (${f.order}, ${f.request}, ${f.plan}, 'plan_proposed', ${f.staff})`;
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

async function asUser(tx: postgres.TransactionSql, id: string) {
  await tx`set local role authenticated`;
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: id, role: 'authenticated' })}, true)`;
}

/** Ведёт заказ по реальному пути до `delivered`, теми же прямыми апдейтами, что и platform-integrity. */
async function deliverOrder(tx: postgres.TransactionSql, f: Fixture) {
  await asUser(tx, f.buyerOwner);
  const [plan] = await tx<{ id: string; version: number }[]>`
    select p.id, p.version from orders o join plans p on p.id = o.approved_plan_id where o.id = ${f.order}`;
  await tx`select approve_plan(${f.order}, ${plan?.id}, ${plan?.version})`;
  await asUser(tx, f.staff);
  await tx`insert into payment_facts (
    order_id, supplier_company_id, direction, kind, status, amount_kzt, reference, confirmed_by, idempotency_key
  ) values (
    ${f.order}, ${f.supplier}, 'outbound', 'supplier_payout', 'confirmed', 100000,
    ${`guard-payout-${crypto.randomUUID()}`}, ${f.staff}, ${`guard-payout-key-${crypto.randomUUID()}`}
  )`;
  await tx`insert into supplier_payouts (order_id, supplier_company_id, amount_kzt, status, paid_at)
    values (${f.order}, ${f.supplier}, 100000, 'paid', now())`;
  await tx`update orders set state = 'suppliers_paid' where id = ${f.order}`;
  await tx`update orders set state = 'in_production' where id = ${f.order}`;
  await tx`update orders set state = 'shipped' where id = ${f.order}`;
  await asUser(tx, f.supplierOwner);
  await tx`select confirm_supplier_delivery(${f.order})`;
  await asUser(tx, f.staff);
  await tx`insert into payment_facts (
    order_id, direction, kind, status, amount_kzt, reference, confirmed_by, idempotency_key
  ) values (
    ${f.order}, 'inbound', 'prepayment', 'confirmed', 123000,
    ${`guard-prepay-${crypto.randomUUID()}`}, ${f.staff}, ${`guard-prepay-key-${crypto.randomUUID()}`}
  )`;
}

async function closeOrder(tx: postgres.TransactionSql, f: Fixture) {
  await deliverOrder(tx, f);
  await asUser(tx, f.buyerOwner);
  await tx`update orders set state = 'accepted', accepted_at = now() where id = ${f.order}`;
  await tx`update orders set state = 'closed', settlement = 'exact', settlement_amount_kzt = 0,
    final_cost_kzt = 123000, closed_at = now() where id = ${f.order}`;
}

describeIfConfigured('защита записи в orders и подтверждения доставки', () => {
  it('консьерж не переписывает финансовые факты закрытого заказа напрямую', async () =>
    scenario(async (tx, f) => {
      await closeOrder(tx, f);
      await asUser(tx, f.staff);
      for (const change of [
        (sp: postgres.TransactionSql) =>
          sp`update orders set final_cost_kzt = 1 where id = ${f.order}`,
        (sp: postgres.TransactionSql) =>
          sp`update orders set settlement = 'refund' where id = ${f.order}`,
        (sp: postgres.TransactionSql) =>
          sp`update orders set settlement_amount_kzt = 999999 where id = ${f.order}`,
        (sp: postgres.TransactionSql) =>
          sp`update orders set closed_at = now() - interval '1 year' where id = ${f.order}`,
      ]) {
        await expect(tx.savepoint((sp) => change(sp))).rejects.toThrow();
      }
      await tx`reset role`;
      const [row] = await tx<{ final_cost_kzt: number; settlement: string }[]>`
        select final_cost_kzt, settlement from orders where id = ${f.order}`;
      expect(Number(row?.final_cost_kzt)).toBe(123000);
      expect(row?.settlement).toBe('exact');
    }));

  it('консьерж не меняет служебные поля заказа, но может назначить ответственного', async () =>
    scenario(async (tx, f) => {
      await asUser(tx, f.staff);
      await expect(
        tx.savepoint(
          (sp) =>
            sp`update orders set created_at = now() - interval '2 years' where id = ${f.order}`,
        ),
      ).rejects.toThrow();
      await tx`update orders set concierge_user_id = ${f.staff} where id = ${f.order}`;
    }));

  it('покупатель не проставляет accepted_at произвольной датой', async () =>
    scenario(async (tx, f) => {
      await deliverOrder(tx, f);
      await asUser(tx, f.buyerOwner);
      await expect(
        tx.savepoint(
          (sp) =>
            sp`update orders set state = 'accepted', accepted_at = '2020-01-01T00:00:00Z' where id = ${f.order}`,
        ),
      ).rejects.toThrow();
      await tx`update orders set state = 'accepted', accepted_at = now() where id = ${f.order}`;
    }));

  it('неназначенный менеджер поставщика не подтверждает доставку, назначенный — может', async () =>
    scenario(async (tx, f) => {
      await asUser(tx, f.buyerOwner);
      const [plan] = await tx<{ id: string; version: number }[]>`
        select p.id, p.version from orders o join plans p on p.id = o.approved_plan_id where o.id = ${f.order}`;
      await tx`select approve_plan(${f.order}, ${plan?.id}, ${plan?.version})`;
      await asUser(tx, f.staff);
      await tx`insert into payment_facts (
        order_id, supplier_company_id, direction, kind, status, amount_kzt, reference, confirmed_by, idempotency_key
      ) values (
        ${f.order}, ${f.supplier}, 'outbound', 'supplier_payout', 'confirmed', 100000,
        ${`guard-payout-${crypto.randomUUID()}`}, ${f.staff}, ${`guard-payout-key-${crypto.randomUUID()}`}
      )`;
      await tx`insert into supplier_payouts (order_id, supplier_company_id, amount_kzt, status, paid_at)
        values (${f.order}, ${f.supplier}, 100000, 'paid', now())`;
      await tx`update orders set state = 'suppliers_paid' where id = ${f.order}`;
      await tx`update orders set state = 'in_production' where id = ${f.order}`;
      await tx`update orders set state = 'shipped' where id = ${f.order}`;

      // RFQ назначен владельцу: менеджер, которому заказ не поручен, не должен его закрывать.
      await tx`reset role`;
      await tx`update rfqs set assigned_supplier_user_id = ${f.supplierOwner} where id = ${f.rfq}`;
      await asUser(tx, f.supplierManager);
      await expect(
        tx.savepoint((sp) => sp`select confirm_supplier_delivery(${f.order})`),
      ).rejects.toThrow();

      await tx`reset role`;
      await tx`update rfqs set assigned_supplier_user_id = ${f.supplierManager} where id = ${f.rfq}`;
      await asUser(tx, f.supplierManager);
      await tx`select confirm_supplier_delivery(${f.order})`;
      await tx`reset role`;
      const [row] = await tx<{ state: string }[]>`select state from orders where id = ${f.order}`;
      expect(row?.state).toBe('delivered');
    }));
});
