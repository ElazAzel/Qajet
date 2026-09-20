import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * Гипотеза P3 из обзора базы: «сторож читает plans.status без блокировки; если
 * персонал одновременно заменит целевой план, заказ останется указывать на
 * заменённый план, и approve_plan потом откажет».
 *
 * Гипотеза была помечена NOT REPRODUCED. Прежде чем ставить замок в триггер (а
 * замок там — это риск взаимных блокировок на горячем пути), надо выяснить, что
 * происходит на самом деле.
 *
 * Чередование задаётся явно, без расчёта на удачное совпадение по времени:
 *   A: BEGIN; UPDATE orders SET approved_plan_id = planB   (сторож видит 'proposed')
 *   B: UPDATE plans SET status='superseded' WHERE id=planB  (автокоммит)
 *   A: COMMIT
 * Транзакции не конфликтуют: A держит строку orders, B — строку plans.
 *
 * Тест НЕ утверждает заранее, что это дефект: он фиксирует исход и то,
 * что система остаётся в согласованном состоянии.
 */

const databaseUrl = process.env.DATABASE_URL;
const describeIfConfigured = databaseUrl ? describe : describe.skip;
const runId = `E2E-${Date.now()}-plan-repoint-race`;

const sql = databaseUrl ? postgres(databaseUrl, { max: 4, prepare: false }) : null;

afterAll(async () => {
  await sql?.end();
});

describeIfConfigured('смена варианта плана и одновременная замена этого плана', () => {
  it('заказ не может указывать на заменённый план: сторож ловит это при COMMIT или отказ наступает позже предсказуемо', async () => {
    const db = sql as postgres.Sql;
    const id = () => crypto.randomUUID();
    const buyerCo = id();
    const supplierCo = id();
    const buyer = id();
    const staff = id();
    const request = id();
    const item = id();
    const planA = id();
    const planB = id();
    const order = id();
    const rfq = id();

    try {
      await db`insert into companies (id, type, name) values
        (${buyerCo}, 'buyer', ${`${runId} buyer`}), (${supplierCo}, 'supplier', ${`${runId} supplier`})`;
      await db`insert into auth.users (id) values (${buyer}), (${staff})`;
      await db`insert into public.users (id, company_id, role, full_name, email) values
        (${buyer}, ${buyerCo}, 'owner', 'Buyer', ${`${buyer}@example.test`}),
        (${staff}, null, 'concierge', 'Staff', ${`${staff}@example.test`})`;
      await db`insert into requests (id, buyer_company_id, created_by, title, raw_text)
        values (${request}, ${buyerCo}, ${buyer}, ${runId}, ${runId})`;
      await db`insert into request_items (id, request_id, name, category, qty, unit)
        values (${item}, ${request}, 'Item', 'merch', 10, 'шт')`;
      await db`insert into rfqs (id, request_id, supplier_company_id, token)
        values (${rfq}, ${request}, ${supplierCo}, ${id()})`;
      await db`insert into plans (id, request_id, kind, total_supplier_kzt, delivery_kzt,
        commission_kzt, commission_base, total_kzt, supplier_count, explanation, status) values
        (${planA}, ${request}, 'recommended', 100000, 0, 23000, 'supplier_ex_delivery', 123000, 1, '{}', 'proposed'),
        (${planB}, ${request}, 'cheaper', 90000, 0, 20700, 'supplier_ex_delivery', 110700, 1, '{}', 'proposed')`;
      await db`insert into orders (id, request_id, approved_plan_id, state, concierge_user_id)
        values (${order}, ${request}, ${planA}, 'plan_proposed', ${staff})`;

      // Соединение A: покупатель начинает переключение и НЕ коммитит.
      const a = await db.reserve();
      const b = await db.reserve();
      let pointer: string | null = null;
      let planStatus: string | null = null;

      try {
        await a`begin`;
        await a`set local role authenticated`;
        await a`select set_config('request.jwt.claims', ${JSON.stringify({ sub: buyer, role: 'authenticated' })}, true)`;
        await a`update orders set approved_plan_id = ${planB} where id = ${order}`;

        // Соединение B: персонал заменяет тот же план и коммитит первым.
        await b`update plans set status = 'superseded' where id = ${planB}`;

        await a`commit`;
      } catch (error) {
        await a`rollback`.catch(() => {});
        throw error;
      } finally {
        await a.release();
        await b.release();
      }

      const [row] = await db`select o.approved_plan_id, p.status
        from orders o join plans p on p.id = o.approved_plan_id where o.id = ${order}`;
      pointer = (row?.approved_plan_id as string) ?? null;
      planStatus = (row?.status as string) ?? null;

      // Что бы ни вышло, система обязана остаться согласованной: указатель
      // ссылается на существующий план ТОЙ ЖЕ заявки.
      const [sameRequest] = await db`select count(*)::int as n from plans
        where id = ${pointer} and request_id = ${request}`;
      expect(sameRequest?.n, 'указатель ведёт на план той же заявки').toBe(1);

      // Исход утверждается, а не печатается: гонка воспроизводится
      // детерминированно, и если она когда-нибудь перестанет воспроизводиться,
      // тест обязан об этом сказать, а не молча продолжить.
      expect(pointer, 'гонка воспроизводится: указатель остаётся на заменённом плане').toBe(planB);
      expect(planStatus, 'план успели заменить').toBe('superseded');

      // Заказ с заменённым планом утвердить нельзя. Отказ — внятное правило,
      // а не случайность.
      const approveAttempt = await (async () => {
        const c = await db.reserve();
        try {
          await c`begin`;
          await c`set local role authenticated`;
          await c`select set_config('request.jwt.claims', ${JSON.stringify({ sub: buyer, role: 'authenticated' })}, true)`;
          await c`update orders set state = 'plan_approved' where id = ${order}`;
          await c`commit`;
          return 'разрешено';
        } catch (error) {
          await c`rollback`.catch(() => {});
          return (error as Error).message;
        } finally {
          await c.release();
        }
      })();
      expect(approveAttempt, 'утверждение заменённого плана должно быть запрещено').toMatch(
        /Сначала утвердите актуальный план|Покупатель не может/,
      );

      // Главное: отказ — это не тупик. Покупатель должен мочь выбрать другой
      // предложенный вариант той же заявки. Если бы не мог, вот ЭТО и было бы
      // дефектом — а не сам факт, что план заменили после его выбора.
      const switchBack = await (async () => {
        const d = await db.reserve();
        try {
          await d`begin`;
          await d`set local role authenticated`;
          await d`select set_config('request.jwt.claims', ${JSON.stringify({ sub: buyer, role: 'authenticated' })}, true)`;
          await d`update orders set approved_plan_id = ${planA} where id = ${order}`;
          await d`commit`;
          return 'выход есть';
        } catch (error) {
          await d`rollback`.catch(() => {});
          return (error as Error).message;
        } finally {
          await d.release();
        }
      })();
      expect(switchBack, 'покупатель должен мочь переключиться на годный вариант').toBe(
        'выход есть',
      );

      const [after] = await db`select approved_plan_id from orders where id = ${order}`;
      expect(after?.approved_plan_id).toBe(planA);
    } finally {
      await db`delete from order_stage_events where order_id = ${order}`.catch(() => {});
      await db`delete from orders where id = ${order}`.catch(() => {});
      await db`delete from plans where request_id = ${request}`.catch(() => {});
      await db`delete from rfqs where request_id = ${request}`.catch(() => {});
      await db`delete from request_items where request_id = ${request}`.catch(() => {});
      await db`delete from requests where id = ${request}`.catch(() => {});
      await db`delete from public.users where id in (${buyer}, ${staff})`.catch(() => {});
      await db`delete from auth.users where id in (${buyer}, ${staff})`.catch(() => {});
      await db`delete from companies where id in (${buyerCo}, ${supplierCo})`.catch(() => {});
    }
  });
});
