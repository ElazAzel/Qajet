import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

/**
 * Запрос изменения утверждённого плана — qajet-master-spec.md §6:
 * «любое изменение цены, срока или состава утверждённого плана требует
 * повторного подтверждения».
 *
 * Воспроизводимые дефекты до миграции 0044:
 *  - два pending-запроса на один заказ (проверка была отдельным чтением);
 *  - запрос и сообщение покупателю писались двумя независимыми запросами.
 *
 * Здесь же проверяется отозванный владелец и закреплённый search_path хелперов.
 * Каждый сценарий откатывается целиком.
 */

const databaseUrl = process.env.DATABASE_URL;
const describeIfConfigured = databaseUrl ? describe : describe.skip;
const rollback = new Error('fixture rollback');

interface Fixture {
  buyerOwner: string;
  buyerManager: string;
  otherBuyerOwner: string;
  supplierOwner: string;
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
        const f: Fixture = {
          buyerOwner: id(),
          buyerManager: id(),
          otherBuyerOwner: id(),
          supplierOwner: id(),
          staff: id(),
          order: id(),
        };
        const request = id();
        const item = id();
        const rfq = id();
        const plan = id();
        await tx`insert into companies (id, type, name) values
          (${buyer}, 'buyer', 'E2E-change buyer'),
          (${otherBuyer}, 'buyer', 'E2E-change other buyer'),
          (${supplier}, 'supplier', 'E2E-change supplier')`;
        await tx`insert into auth.users (id) values
          (${f.buyerOwner}), (${f.buyerManager}), (${f.otherBuyerOwner}), (${f.supplierOwner}), (${f.staff})`;
        await tx`insert into public.users (id, company_id, role, full_name, email) values
          (${f.buyerOwner}, ${buyer}, 'owner', 'Owner', 'e2e-change-owner@example.com'),
          (${f.buyerManager}, ${buyer}, 'manager', 'Manager', 'e2e-change-manager@example.com'),
          (${f.otherBuyerOwner}, ${otherBuyer}, 'owner', 'Other', 'e2e-change-other@example.com'),
          (${f.supplierOwner}, ${supplier}, 'owner', 'Supplier', 'e2e-change-supplier@example.com'),
          (${f.staff}, null, 'concierge', 'Staff', 'e2e-change-staff@example.com')`;
        await tx`insert into requests (id, buyer_company_id, created_by, title, raw_text)
          values (${request}, ${buyer}, ${f.buyerOwner}, 'E2E-change', 'E2E-change')`;
        await tx`insert into request_items (id, request_id, name, category, qty, unit)
          values (${item}, ${request}, 'Item', 'merch', 10, 'шт')`;
        await tx`insert into rfqs (id, request_id, supplier_company_id, token)
          values (${rfq}, ${request}, ${supplier}, ${id()})`;
        await tx`insert into plans (id, request_id, kind, total_supplier_kzt, delivery_kzt, commission_kzt, commission_base, total_kzt, supplier_count, explanation, status)
          values (${plan}, ${request}, 'recommended', 100000, 0, 23000, 'supplier_ex_delivery', 123000, 1, '{}', 'proposed')`;
        const quote = id();
        const quoteLine = id();
        await tx`insert into quotes (id, rfq_id) values (${quote}, ${rfq})`;
        await tx`insert into quote_lines (id, quote_id, request_item_id, unit_price_kzt, lead_time_days)
          values (${quoteLine}, ${quote}, ${item}, 10000, 2)`;
        await tx`insert into plan_lines (plan_id, request_item_id, supplier_company_id, quote_line_id, qty, line_total_kzt, commission_pct, commission_kzt)
          values (${plan}, ${item}, ${supplier}, ${quoteLine}, 10, 100000, 23, 23000)`;
        await tx`insert into orders (id, request_id, approved_plan_id, state, concierge_user_id)
          values (${f.order}, ${request}, ${plan}, 'plan_proposed', ${f.staff})`;
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

async function approve(tx: postgres.TransactionSql, f: Fixture) {
  await asUser(tx, f.buyerOwner);
  const [plan] = await tx<{ id: string; version: number }[]>`
    select p.id, p.version from orders o join plans p on p.id = o.approved_plan_id where o.id = ${f.order}`;
  if (!plan) throw new Error('fixture: у заказа нет плана');
  await tx`select approve_plan(${f.order}, ${plan.id}, ${plan.version})`;
}

describeIfConfigured('запрос изменения утверждённого плана', () => {
  it('создаёт запрос и сообщение покупателя одной операцией', async () =>
    scenario(async (tx, f) => {
      await approve(tx, f);
      const [row] = await tx<{ id: string }[]>`
        select request_plan_change(${f.order}, 'Увеличить тираж до 200', 15000, 0) as id`;
      if (!row) throw new Error('rpc не вернул id');
      const [change] = await tx<
        { status: string; diff: { reason: string; expectedPlanVersion: number } }[]
      >`
        select status, diff from change_requests where id = ${row.id}`;
      expect(change?.status).toBe('pending');
      expect(change?.diff.reason).toBe('Увеличить тираж до 200');
      expect(change?.diff.expectedPlanVersion).toBe(1);
      const messages = await tx<{ body: string }[]>`
        select m.body from messages m join threads t on t.id = m.thread_id
        where t.order_id = ${f.order} and t.kind = 'buyer'`;
      expect(messages.map((m) => m.body)).toContain(
        'Запрос изменения условий: Увеличить тираж до 200',
      );
    }));

  it('второй запрос по тому же заказу отклоняется, в том числе прямой вставкой', async () =>
    scenario(async (tx, f) => {
      await approve(tx, f);
      await tx`select request_plan_change(${f.order}, 'Первое изменение', 0, 0)`;
      await expect(
        tx.savepoint((sp) => sp`select request_plan_change(${f.order}, 'Второе изменение', 0, 0)`),
      ).rejects.toThrow('уже есть запрос');
      // Гонка двух вкладок обходит проверку в коде — держит именно индекс.
      await tx`reset role`;
      const [plan] = await tx<
        { id: string }[]
      >`select approved_plan_id as id from orders where id = ${f.order}`;
      await expect(
        tx.savepoint(
          (
            sp,
          ) => sp`insert into change_requests (order_id, proposed_plan_id, initiator_user_id, diff, status)
            values (${f.order}, ${plan?.id as string}, ${f.buyerOwner}, '{}', 'pending')`,
        ),
      ).rejects.toThrow(/change_requests_one_pending_per_order/);
    }));

  it('чужой покупатель и поставщик не могут запросить изменение', async () =>
    scenario(async (tx, f) => {
      await approve(tx, f);
      for (const user of [f.otherBuyerOwner, f.supplierOwner]) {
        await asUser(tx, user);
        await expect(
          tx.savepoint((sp) => sp`select request_plan_change(${f.order}, 'Чужое изменение', 0, 0)`),
        ).rejects.toThrow();
      }
      await tx`reset role`;
      const [count] = await tx<
        { n: string }[]
      >`select count(*) as n from change_requests where order_id = ${f.order}`;
      expect(Number(count?.n)).toBe(0);
    }));

  it('запрос недоступен до утверждения плана и с некорректными данными', async () =>
    scenario(async (tx, f) => {
      await asUser(tx, f.buyerOwner);
      await expect(
        tx.savepoint((sp) => sp`select request_plan_change(${f.order}, 'До утверждения', 0, 0)`),
      ).rejects.toThrow('до выплаты');
      await approve(tx, f);
      await expect(
        tx.savepoint((sp) => sp`select request_plan_change(${f.order}, 'ок', 0, 0)`),
      ).rejects.toThrow('от 5 до 2000');
    }));
});

describeIfConfigured('управление доступами команды и хелперы RLS', () => {
  it('отозванный владелец не меняет лимиты и доступы, активный — меняет', async () =>
    scenario(async (tx, f) => {
      await asUser(tx, f.buyerOwner);
      const [ok] = await tx<{ approval_limit_kzt: number }[]>`
        select approval_limit_kzt from set_team_member_access(${f.buyerManager}, 500000, true)`;
      expect(Number(ok?.approval_limit_kzt)).toBe(500000);

      await tx`reset role`;
      await tx`update public.users set is_active = false where id = ${f.buyerOwner}`;
      await asUser(tx, f.buyerOwner);
      await expect(
        tx.savepoint(
          (sp) => sp`select * from set_team_member_access(${f.buyerManager}, 999999999, true)`,
        ),
      ).rejects.toThrow();
      await tx`reset role`;
      const [row] = await tx<{ approval_limit_kzt: number }[]>`
        select approval_limit_kzt from public.users where id = ${f.buyerManager}`;
      expect(Number(row?.approval_limit_kzt)).toBe(500000);
    }));

  it('хелперы RLS закреплены на пустой search_path', async () =>
    scenario(async (tx) => {
      const rows = await tx<{ proname: string; proconfig: string[] | null }[]>`
        select proname, proconfig from pg_proc
        where pronamespace = 'public'::regnamespace
          and proname in ('current_role', 'current_company_id',
                          'buyer_company_ids_for_current_supplier', 'rfq_request_ids_for_current_supplier')`;
      expect(rows).toHaveLength(4);
      for (const row of rows) {
        expect(row.proconfig, row.proname).toContain('search_path=""');
      }
    }));
});
