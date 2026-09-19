import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

/**
 * Предоплата — первый платёжный шаг закупки (qajet-master-spec.md §6).
 *
 * Найдено сквозным прогоном приложения: у таблицы `prepayments` были политики
 * SELECT и INSERT, но не UPDATE. Из-за этого консьерж не мог подтвердить
 * предоплату: `confirm_prepayment` берёт строку `SELECT ... FOR UPDATE`, а под
 * RLS без права UPDATE блокировка ничего не находит, и функция отвечала
 * «Сначала выставьте счёт на предоплату», хотя счёт был. Повторное «Выставить
 * счёт» падало на `INSERT ... ON CONFLICT DO UPDATE` сырой ошибкой RLS.
 *
 * Локальные проверки не ловили это, потому что работали с сидом, где строка
 * предоплаты создана владельцем базы в обход RLS.
 */

const databaseUrl = process.env.DATABASE_URL;
const describeIfConfigured = databaseUrl ? describe : describe.skip;
const rollback = new Error('fixture rollback');

interface Fixture {
  buyerOwner: string;
  staff: string;
  order: string;
  request: string;
}

async function scenario(run: (tx: postgres.TransactionSql, f: Fixture) => Promise<void>) {
  const sql = postgres(databaseUrl as string, { max: 1, prepare: false });
  try {
    await sql
      .begin(async (tx) => {
        const buyer = crypto.randomUUID();
        const f: Fixture = {
          buyerOwner: crypto.randomUUID(),
          staff: crypto.randomUUID(),
          order: crypto.randomUUID(),
          request: crypto.randomUUID(),
        };
        await tx`insert into companies (id, type, name) values (${buyer}, 'buyer', 'E2E-prepay buyer')`;
        await tx`insert into auth.users (id) values (${f.buyerOwner}), (${f.staff})`;
        await tx`insert into public.users (id, company_id, role, full_name, email) values
          (${f.buyerOwner}, ${buyer}, 'owner', 'Buyer', 'e2e-prepay-buyer@example.com'),
          (${f.staff}, null, 'concierge', 'Staff', 'e2e-prepay-staff@example.com')`;
        await tx`insert into requests (id, buyer_company_id, created_by, title, raw_text)
          values (${f.request}, ${buyer}, ${f.buyerOwner}, 'E2E-prepay', 'E2E-prepay')`;
        // Заглушка плана, как её создаёт intake_request: у заказа он обязателен.
        const plan = crypto.randomUUID();
        await tx`insert into plans (id, request_id, kind, total_supplier_kzt, delivery_kzt, commission_kzt, commission_base, total_kzt, supplier_count, explanation, status)
          values (${plan}, ${f.request}, 'recommended', 0, 0, 0, 'supplier_ex_delivery', 0, 0, '{}', 'draft')`;
        await tx`insert into orders (id, request_id, approved_plan_id, state, concierge_user_id)
          values (${f.order}, ${f.request}, ${plan}, 'estimated', ${f.staff})`;
        // Счёт выставляется при переходе в estimated (advance_order_stage) — здесь он уже есть.
        await tx`insert into prepayments (request_id, amount_kzt, invoice_no, status)
          values (${f.request}, 187500, 'PRE-E2E', 'issued')`;
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

describeIfConfigured('предоплата: выставление и подтверждение', () => {
  it('консьерж подтверждает предоплату: заказ уходит в prepaid, факт записан, статус paid', async () =>
    scenario(async (tx, f) => {
      await asUser(tx, f.staff);
      await tx`select confirm_prepayment(${f.order}, 187500, 'E2E-PRE-1', now(), null, 'e2e-prepay-key-1')`;
      await tx`reset role`;
      const [order] = await tx<{ state: string }[]>`select state from orders where id = ${f.order}`;
      const [prepayment] = await tx<{ status: string }[]>`
        select status from prepayments where request_id = ${f.request}`;
      const [facts] = await tx<{ n: string }[]>`
        select count(*) as n from payment_facts where order_id = ${f.order} and kind = 'prepayment' and status = 'confirmed'`;
      expect(order?.state).toBe('prepaid');
      expect(prepayment?.status).toBe('paid');
      expect(Number(facts?.n)).toBe(1);
    }));

  it('повторное подтверждение с тем же ключом не создаёт второй факт', async () =>
    scenario(async (tx, f) => {
      await asUser(tx, f.staff);
      await tx`select confirm_prepayment(${f.order}, 187500, 'E2E-PRE-2', now(), null, 'e2e-prepay-key-2')`;
      await tx`select confirm_prepayment(${f.order}, 187500, 'E2E-PRE-2', now(), null, 'e2e-prepay-key-2')`;
      await tx`reset role`;
      const [facts] = await tx<{ n: string }[]>`
        select count(*) as n from payment_facts where order_id = ${f.order} and kind = 'prepayment'`;
      expect(Number(facts?.n)).toBe(1);
    }));

  it('повторное выставление счёта (upsert) работает и не подменяет статус на paid', async () =>
    scenario(async (tx, f) => {
      await asUser(tx, f.staff);
      await tx`insert into prepayments (request_id, amount_kzt, invoice_no, status, paid_at)
        values (${f.request}, 187500, 'PRE-E2E', 'issued', null)
        on conflict (request_id) do update
          set amount_kzt = excluded.amount_kzt, invoice_no = excluded.invoice_no,
              status = excluded.status, paid_at = excluded.paid_at`;
      await tx`reset role`;
      const [row] = await tx<{ status: string }[]>`
        select status from prepayments where request_id = ${f.request}`;
      expect(row?.status).toBe('issued');
    }));

  it('статус paid без подтверждённого банковского факта невозможен даже для консьержа', async () =>
    scenario(async (tx, f) => {
      await asUser(tx, f.staff);
      await expect(
        tx.savepoint(
          (sp) =>
            sp`update prepayments set status = 'paid', paid_at = now() where request_id = ${f.request}`,
        ),
      ).rejects.toThrow('банковского факта');
    }));

  it('покупатель не подтверждает и не меняет предоплату', async () =>
    scenario(async (tx, f) => {
      await asUser(tx, f.buyerOwner);
      await expect(
        tx.savepoint(
          (sp) =>
            sp`select confirm_prepayment(${f.order}, 187500, 'E2E-PRE-3', now(), null, 'e2e-prepay-key-3')`,
        ),
      ).rejects.toThrow();
      const updated =
        await tx`update prepayments set amount_kzt = 1 where request_id = ${f.request} returning id`;
      expect(updated).toHaveLength(0);
      await tx`reset role`;
      const [row] = await tx<{ amount_kzt: number }[]>`
        select amount_kzt from prepayments where request_id = ${f.request}`;
      expect(Number(row?.amount_kzt)).toBe(187500);
    }));
});
