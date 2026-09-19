import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

/**
 * Запрос изменения плана нельзя переписать задним числом (G7).
 *
 * `change_requests_update_staff` давала консьержу право менять любые колонки:
 * подменить причину и суммы, чужой заказ и план, вернуть закрытый запрос в
 * `pending`. `diff->>'reason'` при этом служит запасным источником причины
 * перехода заказа, так что подмена текста меняла запись аудита. Допустимо
 * ровно одно: перевести `pending` в `accepted` или `declined` (при принятии
 * добавляются `appliedPlanId` и `appliedAt`).
 */

const databaseUrl = process.env.DATABASE_URL;
const describeIfConfigured = databaseUrl ? describe : describe.skip;
const rollback = new Error('fixture rollback');

interface Fixture {
  staff: string;
  buyerOwner: string;
  change: string;
  order: string;
}

async function scenario(run: (tx: postgres.TransactionSql, f: Fixture) => Promise<void>) {
  const sql = postgres(databaseUrl as string, { max: 1, prepare: false });
  try {
    await sql
      .begin(async (tx) => {
        const id = () => crypto.randomUUID();
        const buyer = id();
        const request = id();
        const plan = id();
        const f: Fixture = { staff: id(), buyerOwner: id(), change: id(), order: id() };
        await tx`insert into companies (id, type, name) values (${buyer}, 'buyer', 'E2E-change-guard buyer')`;
        await tx`insert into auth.users (id) values (${f.staff}), (${f.buyerOwner})`;
        await tx`insert into public.users (id, company_id, role, full_name, email) values
          (${f.staff}, null, 'concierge', 'Staff', 'e2e-cg-staff@example.com'),
          (${f.buyerOwner}, ${buyer}, 'owner', 'Buyer', 'e2e-cg-buyer@example.com')`;
        await tx`insert into requests (id, buyer_company_id, created_by, title, raw_text)
          values (${request}, ${buyer}, ${f.buyerOwner}, 'E2E-cg', 'E2E-cg')`;
        await tx`insert into plans (id, request_id, kind, total_supplier_kzt, delivery_kzt, commission_kzt, commission_base, total_kzt, supplier_count, explanation, status)
          values (${plan}, ${request}, 'recommended', 0, 0, 0, 'supplier_ex_delivery', 0, 0, '{}', 'draft')`;
        await tx`insert into orders (id, request_id, approved_plan_id, state, concierge_user_id)
          values (${f.order}, ${request}, ${plan}, 'plan_approved', ${f.staff})`;
        await tx`insert into change_requests (id, order_id, proposed_plan_id, initiator_user_id, diff, status)
          values (${f.change}, ${f.order}, ${plan}, ${f.buyerOwner},
            ${tx.json({ reason: 'Нужен тираж 200', requestedSupplierDeltaKzt: 1000, requestedDeliveryDeltaKzt: 0 })}, 'pending')`;
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

describeIfConfigured('целостность запросов изменения плана', () => {
  it('консьерж не переписывает причину, суммы и привязки запроса', async () =>
    scenario(async (tx, f) => {
      await asUser(tx, f.staff);
      const attempts = [
        (sp: postgres.TransactionSql) =>
          sp`update change_requests set diff = jsonb_set(diff, '{reason}', '"Подмена причины"') where id = ${f.change}`,
        (sp: postgres.TransactionSql) =>
          sp`update change_requests set diff = jsonb_set(diff, '{requestedSupplierDeltaKzt}', '999999') where id = ${f.change}`,
        (sp: postgres.TransactionSql) =>
          sp`update change_requests set initiator_user_id = ${f.staff} where id = ${f.change}`,
        (sp: postgres.TransactionSql) =>
          sp`update change_requests set order_id = ${crypto.randomUUID()} where id = ${f.change}`,
      ];
      for (const attempt of attempts) {
        await expect(tx.savepoint((sp) => attempt(sp))).rejects.toThrow();
      }
      await tx`reset role`;
      const [row] = await tx<
        { reason: string }[]
      >`select diff->>'reason' as reason from change_requests where id = ${f.change}`;
      expect(row?.reason).toBe('Нужен тираж 200');
    }));

  it('консьерж может отклонить pending-запрос, но не вернуть обработанный в pending', async () =>
    scenario(async (tx, f) => {
      await asUser(tx, f.staff);
      await tx`update change_requests set status = 'declined', updated_at = now() where id = ${f.change} and status = 'pending'`;
      await expect(
        tx.savepoint(
          (sp) => sp`update change_requests set status = 'pending' where id = ${f.change}`,
        ),
      ).rejects.toThrow();
      await expect(
        tx.savepoint(
          (sp) => sp`update change_requests set status = 'accepted' where id = ${f.change}`,
        ),
      ).rejects.toThrow();
    }));

  it('при принятии допустимо добавить appliedPlanId и appliedAt, и только их', async () =>
    scenario(async (tx, f) => {
      await asUser(tx, f.staff);
      await tx`update change_requests
        set status = 'accepted', diff = diff || ${tx.json({ appliedPlanId: crypto.randomUUID(), appliedAt: new Date().toISOString() })}
        where id = ${f.change}`;
      await tx`reset role`;
      const [row] = await tx<
        { status: string }[]
      >`select status from change_requests where id = ${f.change}`;
      expect(row?.status).toBe('accepted');
    }));

  it('покупатель не меняет запрос после создания', async () =>
    scenario(async (tx, f) => {
      await asUser(tx, f.buyerOwner);
      const changed =
        await tx`update change_requests set status = 'declined' where id = ${f.change} returning id`;
      expect(changed).toHaveLength(0);
    }));
});
