import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

/**
 * Идемпотентная отправка заявки. Раньше от двойной отправки защищала только
 * блокировка кнопки на клиенте: двойной клик до перерисовки или повтор после
 * обрыва сети создавал вторую заявку с теми же позициями, и консьерж видел
 * дубль в очереди. Ключ отправки делает повтор безопасным на уровне базы.
 */

const databaseUrl = process.env.DATABASE_URL;
const describeIfConfigured = databaseUrl ? describe : describe.skip;
const rollback = new Error('fixture rollback');

const ITEMS = [{ name: 'Футболка с логотипом', category: 'merch', qty: 100, unit: 'шт' }];

async function scenario(
  run: (
    tx: postgres.TransactionSql,
    f: { buyerA: string; buyerB: string; staff: string },
  ) => Promise<void>,
) {
  const sql = postgres(databaseUrl as string, { max: 1, prepare: false });
  try {
    await sql
      .begin(async (tx) => {
        const companyA = crypto.randomUUID();
        const companyB = crypto.randomUUID();
        const f = {
          buyerA: crypto.randomUUID(),
          buyerB: crypto.randomUUID(),
          staff: crypto.randomUUID(),
        };
        await tx`insert into companies (id, type, name) values
          (${companyA}, 'buyer', 'E2E-idem buyer A'), (${companyB}, 'buyer', 'E2E-idem buyer B')`;
        await tx`insert into auth.users (id) values (${f.buyerA}), (${f.buyerB}), (${f.staff})`;
        await tx`insert into public.users (id, company_id, role, full_name, email) values
          (${f.buyerA}, ${companyA}, 'owner', 'A', 'e2e-idem-a@example.com'),
          (${f.buyerB}, ${companyB}, 'owner', 'B', 'e2e-idem-b@example.com'),
          (${f.staff}, null, 'concierge', 'Staff', 'e2e-idem-staff@example.com')`;
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

async function create(tx: postgres.TransactionSql, title: string, key: string | null) {
  const [row] = await tx<{ id: string }[]>`
    select create_request_with_items(
      ${title}, 'E2E-idem', null, null, null, 'Алматы', ${tx.json(ITEMS)}, ${key}::uuid
    ) as id`;
  if (!row) throw new Error('rpc не вернул id');
  return row.id;
}

describeIfConfigured('идемпотентная отправка заявки', () => {
  it('повторная отправка с тем же ключом возвращает ту же заявку и не дублирует позиции', async () =>
    scenario(async (tx, f) => {
      await asUser(tx, f.buyerA);
      const key = crypto.randomUUID();
      const first = await create(tx, 'E2E-idem заявка', key);
      const second = await create(tx, 'E2E-idem заявка', key);
      expect(second).toBe(first);
      await tx`reset role`;
      const [requests] = await tx<{ n: string }[]>`
        select count(*) as n from requests where created_by = ${f.buyerA} and submission_key = ${key}`;
      const [items] = await tx<{ n: string }[]>`
        select count(*) as n from request_items where request_id = ${first}`;
      expect(Number(requests?.n)).toBe(1);
      expect(Number(items?.n)).toBe(1);
    }));

  it('разные ключи и отсутствие ключа создают отдельные заявки', async () =>
    scenario(async (tx, f) => {
      await asUser(tx, f.buyerA);
      const a = await create(tx, 'E2E-idem один', crypto.randomUUID());
      const b = await create(tx, 'E2E-idem два', crypto.randomUUID());
      const c = await create(tx, 'E2E-idem три', null);
      const d = await create(tx, 'E2E-idem три', null);
      expect(new Set([a, b, c, d]).size).toBe(4);
    }));

  it('ключ одного покупателя не возвращает заявку другого', async () =>
    scenario(async (tx, f) => {
      const key = crypto.randomUUID();
      await asUser(tx, f.buyerA);
      const a = await create(tx, 'E2E-idem A', key);
      await tx`reset role`;
      await asUser(tx, f.buyerB);
      const b = await create(tx, 'E2E-idem B', key);
      expect(b).not.toBe(a);
    }));

  it('гонка двух вставок с одним ключом останавливается уникальным индексом', async () =>
    scenario(async (tx, f) => {
      await asUser(tx, f.buyerA);
      const key = crypto.randomUUID();
      const id = await create(tx, 'E2E-idem гонка', key);
      await tx`reset role`;
      const [row] = await tx<
        { buyer_company_id: string }[]
      >`select buyer_company_id from requests where id = ${id}`;
      await expect(
        tx.savepoint(
          (
            sp,
          ) => sp`insert into requests (buyer_company_id, created_by, title, raw_text, submission_key)
            values (${row?.buyer_company_id as string}, ${f.buyerA}, 'E2E-idem дубль', 'x', ${key})`,
        ),
      ).rejects.toThrow(/requests_created_by_submission_key_unique/);
    }));

  it('сотрудник QAJET не создаёт заявки от имени покупателя', async () =>
    scenario(async (tx, f) => {
      await asUser(tx, f.staff);
      await expect(
        tx.savepoint((sp) => create(sp, 'E2E-idem staff', crypto.randomUUID())),
      ).rejects.toThrow('Только активный покупатель');
    }));
});
