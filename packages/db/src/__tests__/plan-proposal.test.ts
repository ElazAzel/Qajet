import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

/**
 * Первое предложение плана — главное действие консьержа (qajet-master-spec.md §8D).
 *
 * Найдено сквозным прогоном приложения: «Предложить этот план» на свежем заказе
 * отвечал «План не сходится: строки 0, supplier 0, комиссия 0, итог 0», заказ
 * оставался в `quotes_received`. `propose_order_plans` переводит прежний план
 * заказа в `superseded`, а при первом предложении прежний план — пустая
 * заглушка-черновик, созданная при приёме заявки. Отложенный триггер сверки
 * видит план с непустым статусом и без строк и откатывает всю транзакцию.
 *
 * Демо-сид этого не ловил: он вставляет планы от имени владельца базы, а
 * триггер сверки для него отключён.
 */

const databaseUrl = process.env.DATABASE_URL;
const describeIfConfigured = databaseUrl ? describe : describe.skip;
const rollback = new Error('fixture rollback');

interface Fixture {
  staff: string;
  order: string;
  request: string;
  placeholder: string;
  item: string;
  supplier: string;
  quoteLine: string;
}

async function scenario(run: (tx: postgres.TransactionSql, f: Fixture) => Promise<void>) {
  const sql = postgres(databaseUrl as string, { max: 1, prepare: false });
  try {
    await sql
      .begin(async (tx) => {
        const id = () => crypto.randomUUID();
        const buyer = id();
        const buyerOwner = id();
        const supplierOwner = id();
        const rfq = id();
        const quote = id();
        const f: Fixture = {
          staff: id(),
          order: id(),
          request: id(),
          placeholder: id(),
          item: id(),
          supplier: id(),
          quoteLine: id(),
        };
        await tx`insert into companies (id, type, name) values
          (${buyer}, 'buyer', 'E2E-proposal buyer'), (${f.supplier}, 'supplier', 'E2E-proposal supplier')`;
        await tx`insert into auth.users (id) values (${f.staff}), (${buyerOwner}), (${supplierOwner})`;
        await tx`insert into public.users (id, company_id, role, full_name, email) values
          (${f.staff}, null, 'concierge', 'Staff', 'e2e-proposal-staff@example.com'),
          (${buyerOwner}, ${buyer}, 'owner', 'Buyer', 'e2e-proposal-buyer@example.com'),
          (${supplierOwner}, ${f.supplier}, 'owner', 'Supplier', 'e2e-proposal-supplier@example.com')`;
        await tx`insert into requests (id, buyer_company_id, created_by, title, raw_text)
          values (${f.request}, ${buyer}, ${buyerOwner}, 'E2E-proposal', 'E2E-proposal')`;
        await tx`insert into request_items (id, request_id, name, category, qty, unit)
          values (${f.item}, ${f.request}, 'Item', 'merch', 10, 'шт')`;
        await tx`insert into rfqs (id, request_id, supplier_company_id, token)
          values (${rfq}, ${f.request}, ${f.supplier}, ${id()})`;
        await tx`insert into quotes (id, rfq_id) values (${quote}, ${rfq})`;
        await tx`insert into quote_lines (id, quote_id, request_item_id, unit_price_kzt, lead_time_days, capability_confirmed)
          values (${f.quoteLine}, ${quote}, ${f.item}, 10000, 2, true)`;
        // Пустая заглушка, как её создаёт intake_request: у заказа план обязателен.
        await tx`insert into plans (id, request_id, kind, total_supplier_kzt, delivery_kzt, commission_kzt, commission_base, total_kzt, supplier_count, explanation, status)
          values (${f.placeholder}, ${f.request}, 'manual', 0, 0, 0, 'supplier_ex_delivery', 0, 0, '{}', 'draft')`;
        await tx`insert into orders (id, request_id, approved_plan_id, state, concierge_user_id)
          values (${f.order}, ${f.request}, ${f.placeholder}, 'quotes_received', ${f.staff})`;
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

function planPayload(f: Fixture, kind: string) {
  return {
    kind,
    total_supplier_kzt: 100000,
    delivery_kzt: 0,
    commission_kzt: 23000,
    commission_base: 'supplier_ex_delivery',
    tax_effect_kzt: 0,
    total_kzt: 123000,
    eta_date: '2027-01-15',
    slack_days: 5,
    supplier_count: 1,
    explanation: {},
    lines: [
      {
        request_item_id: f.item,
        supplier_company_id: f.supplier,
        quote_line_id: f.quoteLine,
        qty: 10,
        line_total_kzt: 100000,
        commission_pct: 23,
        commission_kzt: 23000,
      },
    ],
  };
}

describeIfConfigured('первое предложение плана консьержем', () => {
  it('переводит заказ в plan_proposed и сохраняет варианты со строками', async () =>
    scenario(async (tx, f) => {
      await asUser(tx, f.staff);
      const plans = [planPayload(f, 'recommended'), planPayload(f, 'cheaper')];
      await tx`select propose_order_plans(${f.order}, 'quotes_received', ${tx.json(plans)}, ${tx.json([])}, 'recommended')`;
      // Триггер сверки отложенный: он срабатывает при фиксации, поэтому форсируем его здесь.
      await tx`set constraints all immediate`;
      await tx`reset role`;
      const [order] = await tx<{ state: string; approved_plan_id: string }[]>`
        select state, approved_plan_id from orders where id = ${f.order}`;
      const proposed = await tx<{ id: string; lines: string }[]>`
        select p.id, (select count(*) from plan_lines l where l.plan_id = p.id) as lines
        from plans p where p.request_id = ${f.request} and p.status = 'proposed'`;
      expect(order?.state).toBe('plan_proposed');
      expect(order?.approved_plan_id).not.toBe(f.placeholder);
      expect(proposed).toHaveLength(2);
      for (const plan of proposed) expect(Number(plan.lines)).toBe(1);
    }));

  it('пустая заглушка не помечается superseded — у неё нет строк, сверка её отвергла бы', async () =>
    scenario(async (tx, f) => {
      await asUser(tx, f.staff);
      await tx`select propose_order_plans(${f.order}, 'quotes_received', ${tx.json([planPayload(f, 'recommended')])}, ${tx.json([])}, 'recommended')`;
      await tx`set constraints all immediate`;
      await tx`reset role`;
      const [placeholder] = await tx<{ status: string }[]>`
        select status from plans where id = ${f.placeholder}`;
      expect(placeholder?.status).toBe('draft');
    }));

  it('покупатель не предлагает план', async () =>
    scenario(async (tx, f) => {
      const [owner] = await tx<{ id: string }[]>`
        select u.id from users u join requests r on r.buyer_company_id = u.company_id where r.id = ${f.request}`;
      await asUser(tx, owner?.id as string);
      await expect(
        tx.savepoint(
          (sp) =>
            sp`select propose_order_plans(${f.order}, 'quotes_received', ${sp.json([planPayload(f, 'recommended')])}, ${sp.json([])}, 'recommended')`,
        ),
      ).rejects.toThrow('Только консьерж');
    }));
});
