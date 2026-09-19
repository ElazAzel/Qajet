import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

/**
 * Учёт активного времени консьержа — qajet-master-spec.md §9: «Учёт времени —
 * функция первого класса», от неё зависят `/metrics` и юнит-экономика.
 *
 * Найдено сквозным прогоном приложения: `record_active_time_heartbeat` падал
 * с SQLSTATE 42P10 на каждом вызове. Уникальный индекс по `interval_id`
 * частичный (`WHERE interval_id IS NOT NULL`), а `ON CONFLICT (interval_id)`
 * без такого же предиката его не находит. На экране консьержа это выглядело
 * как красная ошибка в блоке «Учёт времени», а часы не копились вовсе.
 */

const databaseUrl = process.env.DATABASE_URL;
const describeIfConfigured = databaseUrl ? describe : describe.skip;
const rollback = new Error('fixture rollback');

interface Fixture {
  staff: string;
  buyerOwner: string;
  order: string;
}

async function scenario(run: (tx: postgres.TransactionSql, f: Fixture) => Promise<void>) {
  const sql = postgres(databaseUrl as string, { max: 1, prepare: false });
  try {
    await sql
      .begin(async (tx) => {
        const buyer = crypto.randomUUID();
        const request = crypto.randomUUID();
        const plan = crypto.randomUUID();
        const f: Fixture = {
          staff: crypto.randomUUID(),
          buyerOwner: crypto.randomUUID(),
          order: crypto.randomUUID(),
        };
        await tx`insert into companies (id, type, name) values (${buyer}, 'buyer', 'E2E-time buyer')`;
        await tx`insert into auth.users (id) values (${f.staff}), (${f.buyerOwner})`;
        await tx`insert into public.users (id, company_id, role, full_name, email) values
          (${f.staff}, null, 'concierge', 'Staff', 'e2e-time-staff@example.com'),
          (${f.buyerOwner}, ${buyer}, 'owner', 'Buyer', 'e2e-time-buyer@example.com')`;
        await tx`insert into requests (id, buyer_company_id, created_by, title, raw_text)
          values (${request}, ${buyer}, ${f.buyerOwner}, 'E2E-time', 'E2E-time')`;
        await tx`insert into plans (id, request_id, kind, total_supplier_kzt, delivery_kzt, commission_kzt, commission_base, total_kzt, supplier_count, explanation, status)
          values (${plan}, ${request}, 'recommended', 0, 0, 0, 'supplier_ex_delivery', 0, 0, '{}', 'draft')`;
        await tx`insert into orders (id, request_id, approved_plan_id, state, concierge_user_id)
          values (${f.order}, ${request}, ${plan}, 'draft', ${f.staff})`;
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

const INTERVAL = 'e2e-interval-0123456789abcdef';

describeIfConfigured('учёт активного времени: heartbeat', () => {
  it('первый вызов создаёт запись, повторный с тем же интервалом обновляет её, а не падает', async () =>
    scenario(async (tx, f) => {
      await asUser(tx, f.staff);
      const startedAt = new Date(Date.now() - 20_000).toISOString();
      await tx`select record_active_time_heartbeat(${f.order}, 'intake', ${INTERVAL}, ${startedAt}::timestamptz)`;
      await tx`select record_active_time_heartbeat(${f.order}, 'intake', ${INTERVAL}, ${startedAt}::timestamptz)`;
      await tx`reset role`;
      const rows = await tx<{ seconds: number }[]>`
        select seconds from time_entries where order_id = ${f.order} and interval_id = ${INTERVAL}`;
      expect(rows).toHaveLength(1);
      // 20 секунд с начала интервала; повторный вызов добавляет не больше минуты.
      expect(rows[0]?.seconds).toBeGreaterThanOrEqual(19);
      expect(rows[0]?.seconds).toBeLessThanOrEqual(80);
    }));

  it('второй интервал в пределах минуты не удваивает время: возвращается уже идущий', async () =>
    scenario(async (tx, f) => {
      await asUser(tx, f.staff);
      const startedAt = new Date(Date.now() - 10_000).toISOString();
      await tx`select record_active_time_heartbeat(${f.order}, 'intake', ${INTERVAL}, ${startedAt}::timestamptz)`;
      await tx`select record_active_time_heartbeat(${f.order}, 'intake', 'e2e-interval-second-tab-0001', ${startedAt}::timestamptz)`;
      await tx`reset role`;
      const [row] = await tx<{ n: string }[]>`
        select count(*) as n from time_entries where order_id = ${f.order} and source = 'active'`;
      expect(Number(row?.n)).toBe(1);
    }));

  it('покупатель не записывает активное время', async () =>
    scenario(async (tx, f) => {
      await asUser(tx, f.buyerOwner);
      await expect(
        tx.savepoint(
          (sp) =>
            sp`select record_active_time_heartbeat(${f.order}, 'intake', ${INTERVAL}, ${new Date().toISOString()}::timestamptz)`,
        ),
      ).rejects.toThrow('только сотрудник QAJET');
    }));
});
