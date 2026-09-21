import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

/**
 * Границы актёров у SECURITY DEFINER RPC, доступных authenticated.
 *
 * Эти функции выполняются с правами владельца и обходят RLS, поэтому единственная
 * защита — проверка актёра внутри тела. Раньше для пяти из них не было ни одного
 * теста «чужой не пройдёт»: функция могла бы потерять проверку роли или
 * принадлежности, и ни один тест не покраснел бы.
 *
 * Каждый отказ проверяется по своему сообщению, а не «что-то упало»: иначе тест
 * проходит и тогда, когда вызов отклонён по постороннему поводу.
 * Каждый случай — в транзакции с откатом.
 */

const databaseUrl = process.env.DATABASE_URL;
const describeIfConfigured = databaseUrl ? describe : describe.skip;
const rollback = new Error('fixture rollback');

interface World {
  buyerA: { owner: string; request: string; order: string; planA: string; planB: string };
  buyerB: { owner: string };
  supplierS1: { company: string; owner: string; manager: string; rfq: string };
  supplierS2: { company: string; owner: string };
  otherRequestPlan: string;
  lineA: string;
  lineB: string;
  conciergeUser: string;
  adminUser: string;
  inactiveStaff: string;
  inactiveBuyerOwner: string;
}

async function scenario(run: (tx: postgres.TransactionSql, w: World) => Promise<void>) {
  const sql = postgres(databaseUrl as string, { max: 1, prepare: false });
  const id = () => crypto.randomUUID();
  try {
    await sql
      .begin(async (tx) => {
        const buyerCoA = id();
        const buyerCoB = id();
        const s1Co = id();
        const s2Co = id();
        const w: World = {
          buyerA: {
            owner: id(),
            request: id(),
            order: id(),
            planA: id(),
            planB: id(),
          },
          buyerB: { owner: id() },
          supplierS1: { company: s1Co, owner: id(), manager: id(), rfq: id() },
          supplierS2: { company: s2Co, owner: id() },
          otherRequestPlan: id(),
          lineA: id(),
          lineB: id(),
          conciergeUser: id(),
          adminUser: id(),
          inactiveStaff: id(),
          inactiveBuyerOwner: id(),
        };
        const otherRequest = id();
        const item = id();

        await tx`insert into companies (id, type, name) values
          (${buyerCoA}, 'buyer', 'Buyer A'), (${buyerCoB}, 'buyer', 'Buyer B'),
          (${s1Co}, 'supplier', 'Supplier S1'), (${s2Co}, 'supplier', 'Supplier S2')`;
        const users: [string, string | null, string, boolean][] = [
          [w.buyerA.owner, buyerCoA, 'owner', true],
          [w.buyerB.owner, buyerCoB, 'owner', true],
          [w.supplierS1.owner, s1Co, 'owner', true],
          [w.supplierS1.manager, s1Co, 'manager', true],
          [w.supplierS2.owner, s2Co, 'owner', true],
          [w.conciergeUser, null, 'concierge', true],
          [w.adminUser, null, 'admin', true],
          [w.inactiveStaff, null, 'concierge', false],
          [w.inactiveBuyerOwner, buyerCoA, 'owner', false],
        ];
        for (const [uid] of users) await tx`insert into auth.users (id) values (${uid})`;
        for (const [uid, co, role, active] of users) {
          await tx`insert into public.users (id, company_id, role, full_name, email, is_active)
            values (${uid}, ${co}, ${role}, ${`u-${uid.slice(0, 6)}`}, ${`${uid}@example.test`}, ${active})`;
        }

        await tx`insert into requests (id, buyer_company_id, created_by, title, raw_text) values
          (${w.buyerA.request}, ${buyerCoA}, ${w.buyerA.owner}, 'A', 'A'),
          (${otherRequest}, ${buyerCoB}, ${w.buyerB.owner}, 'B', 'B')`;
        await tx`insert into request_items (id, request_id, name, category, qty, unit)
          values (${item}, ${w.buyerA.request}, 'Item', 'merch', 10, 'шт')`;
        await tx`insert into plans (id, request_id, kind, total_supplier_kzt, delivery_kzt, commission_kzt, commission_base, total_kzt, supplier_count, explanation, status) values
          (${w.buyerA.planA}, ${w.buyerA.request}, 'recommended', 100000, 0, 23000, 'supplier_ex_delivery', 123000, 1, '{}', 'proposed'),
          (${w.buyerA.planB}, ${w.buyerA.request}, 'cheaper', 90000, 0, 20700, 'supplier_ex_delivery', 110700, 1, '{}', 'proposed'),
          (${w.otherRequestPlan}, ${otherRequest}, 'recommended', 50000, 0, 11500, 'supplier_ex_delivery', 61500, 1, '{}', 'proposed')`;
        await tx`insert into orders (id, request_id, approved_plan_id, state, concierge_user_id)
          values (${w.buyerA.order}, ${w.buyerA.request}, ${w.buyerA.planA}, 'plan_proposed', ${w.conciergeUser})`;
        const s2Rfq = id();
        await tx`insert into rfqs (id, request_id, supplier_company_id, token, status) values
          (${w.supplierS1.rfq}, ${w.buyerA.request}, ${s1Co}, ${id()}, 'sent'),
          (${s2Rfq}, ${w.buyerA.request}, ${s2Co}, ${id()}, 'sent')`;
        // Без строк плана сторож заказов и политики поставщика не срабатывают вовсе
        // (у поставщика нет связи с планом), и тесты проходили бы вхолостую.
        const addLine = async (
          planId: string,
          lineId: string,
          rfq: string,
          co: string,
          unit: number,
        ) => {
          const quoteId = id();
          const quoteLineId = id();
          await tx`insert into quotes (id, rfq_id) values (${quoteId}, ${rfq})`;
          await tx`insert into quote_lines (id, quote_id, request_item_id, unit_price_kzt, lead_time_days)
            values (${quoteLineId}, ${quoteId}, ${item}, ${unit}, 2)`;
          await tx`insert into plan_lines (id, plan_id, request_item_id, supplier_company_id, quote_line_id,
            qty, line_total_kzt, commission_pct, commission_kzt)
            values (${lineId}, ${planId}, ${item}, ${co}, ${quoteLineId}, 10, ${unit * 10}, 23, ${Math.round(unit * 10 * 0.23)})`;
        };
        await addLine(w.buyerA.planA, w.lineA, w.supplierS1.rfq, s1Co, 10000);
        await addLine(w.buyerA.planB, w.lineB, s2Rfq, s2Co, 9000);

        await run(tx, w);
        throw rollback;
      })
      .catch((error) => {
        if (error !== rollback) throw error;
      });
  } finally {
    await sql.end();
  }
}

async function asUser(tx: postgres.TransactionSql, userId: string) {
  await tx`reset role`;
  await tx`set local role authenticated`;
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`;
}

async function asAnon(tx: postgres.TransactionSql) {
  await tx`reset role`;
  await tx`set local role anon`;
  await tx`select set_config('request.jwt.claims', '', true)`;
}

async function asOwner(tx: postgres.TransactionSql) {
  await tx`reset role`;
}

/** Причина проверяется всегда; savepoint оставляет транзакцию пригодной для проверок. */
async function expectRejected(
  tx: postgres.TransactionSql,
  reason: RegExp,
  call: () => Promise<unknown>,
) {
  await expect(tx.savepoint(call)).rejects.toThrow(reason);
}

const NOT_STAFF = /Назначать заказ может только сотрудник QAJET/;
const NOT_BUYER = /Только покупатель может выбрать вариант/;
const NO_ORDER = /Нет доступа к заказу/;

describeIfConfigured('SECURITY DEFINER RPC: граница актёра внутри тела функции', () => {
  describe('select_order_plan', () => {
    it('покупатель-владелец выбирает вариант своей закупки', async () => {
      await scenario(async (tx, w) => {
        await asUser(tx, w.buyerA.owner);
        await tx`select public.select_order_plan(${w.buyerA.order}, ${w.buyerA.planA}, ${w.buyerA.planB})`;
        await asOwner(tx);
        const [o] = await tx`select approved_plan_id from orders where id = ${w.buyerA.order}`;
        expect(o?.approved_plan_id).toBe(w.buyerA.planB);
      });
    });

    it('покупатель другой компании не получает доступа к чужому заказу', async () => {
      await scenario(async (tx, w) => {
        await asUser(tx, w.buyerB.owner);
        await expectRejected(
          tx,
          NO_ORDER,
          () =>
            tx`select public.select_order_plan(${w.buyerA.order}, ${w.buyerA.planA}, ${w.buyerA.planB})`,
        );
        await asOwner(tx);
        const [o] = await tx`select approved_plan_id from orders where id = ${w.buyerA.order}`;
        expect(o?.approved_plan_id).toBe(w.buyerA.planA);
      });
    });

    it.each([
      ['поставщик', (w: World) => w.supplierS1.owner],
      ['консьерж', (w: World) => w.conciergeUser],
      ['админ', (w: World) => w.adminUser],
      ['отключённый владелец покупателя', (w: World) => w.inactiveBuyerOwner],
    ])('роль «%s» не может выбирать вариант', async (_name, actor) => {
      await scenario(async (tx, w) => {
        await asUser(tx, actor(w));
        await expectRejected(
          tx,
          NOT_BUYER,
          () =>
            tx`select public.select_order_plan(${w.buyerA.order}, ${w.buyerA.planA}, ${w.buyerA.planB})`,
        );
      });
    });

    it('устаревший ожидаемый план отклоняется (защита от двух вкладок)', async () => {
      await scenario(async (tx, w) => {
        await asUser(tx, w.buyerA.owner);
        await expectRejected(
          tx,
          /Варианты уже изменились/,
          () =>
            tx`select public.select_order_plan(${w.buyerA.order}, ${w.buyerA.planB}, ${w.buyerA.planA})`,
        );
      });
    });

    it('вариант из чужой заявки выбрать нельзя', async () => {
      await scenario(async (tx, w) => {
        await asUser(tx, w.buyerA.owner);
        await expectRejected(
          tx,
          /Вариант больше недоступен/,
          () =>
            tx`select public.select_order_plan(${w.buyerA.order}, ${w.buyerA.planA}, ${w.otherRequestPlan})`,
        );
      });
    });

    it('anon не может вызвать функцию вовсе', async () => {
      await scenario(async (tx, w) => {
        await asAnon(tx);
        await expectRejected(
          tx,
          /permission denied/,
          () =>
            tx`select public.select_order_plan(${w.buyerA.order}, ${w.buyerA.planA}, ${w.buyerA.planB})`,
        );
      });
    });
  });

  describe('assign_order_concierge', () => {
    it('сотрудник QAJET назначает консьержа', async () => {
      await scenario(async (tx, w) => {
        await asUser(tx, w.adminUser);
        await tx`select public.assign_order_concierge(${w.buyerA.order}, ${w.adminUser})`;
        await asOwner(tx);
        const [o] = await tx`select concierge_user_id from orders where id = ${w.buyerA.order}`;
        expect(o?.concierge_user_id).toBe(w.adminUser);
      });
    });

    it.each([
      ['покупатель', (w: World) => w.buyerA.owner],
      ['поставщик', (w: World) => w.supplierS1.owner],
      ['отключённый сотрудник', (w: World) => w.inactiveStaff],
    ])('«%s» не может назначать заказ', async (_name, actor) => {
      await scenario(async (tx, w) => {
        await asUser(tx, actor(w));
        await expectRejected(
          tx,
          NOT_STAFF,
          () => tx`select public.assign_order_concierge(${w.buyerA.order}, ${w.conciergeUser})`,
        );
        await asOwner(tx);
        const [o] = await tx`select concierge_user_id from orders where id = ${w.buyerA.order}`;
        expect(o?.concierge_user_id).toBe(w.conciergeUser);
      });
    });

    it.each([
      ['владелец покупателя', (w: World) => w.buyerA.owner],
      ['владелец поставщика', (w: World) => w.supplierS1.owner],
      ['отключённый консьерж', (w: World) => w.inactiveStaff],
    ])('назначить заказ на «%s» нельзя', async (_name, target) => {
      await scenario(async (tx, w) => {
        await asUser(tx, w.conciergeUser);
        await expectRejected(
          tx,
          /Сотрудник не найден или отключён/,
          () => tx`select public.assign_order_concierge(${w.buyerA.order}, ${target(w)})`,
        );
      });
    });

    it('anon не может вызвать функцию вовсе', async () => {
      await scenario(async (tx, w) => {
        await asAnon(tx);
        await expectRejected(
          tx,
          /permission denied/,
          () => tx`select public.assign_order_concierge(${w.buyerA.order}, ${w.conciergeUser})`,
        );
      });
    });
  });

  describe('assign_supplier_rfq', () => {
    it('владелец поставщика назначает своего менеджера на свой RFQ', async () => {
      await scenario(async (tx, w) => {
        await asUser(tx, w.supplierS1.owner);
        await tx`select public.assign_supplier_rfq(${w.supplierS1.rfq}, ${w.supplierS1.manager})`;
        await asOwner(tx);
        const [r] =
          await tx`select assigned_supplier_user_id from rfqs where id = ${w.supplierS1.rfq}`;
        expect(r?.assigned_supplier_user_id).toBe(w.supplierS1.manager);
      });
    });

    it.each([
      ['менеджер поставщика (не владелец)', (w: World) => w.supplierS1.manager],
      ['покупатель', (w: World) => w.buyerA.owner],
      ['консьерж', (w: World) => w.conciergeUser],
    ])('«%s» не может назначать RFQ', async (_name, actor) => {
      await scenario(async (tx, w) => {
        await asUser(tx, actor(w));
        await expectRejected(
          tx,
          /только владелец компании-поставщика/,
          () => tx`select public.assign_supplier_rfq(${w.supplierS1.rfq}, ${w.supplierS1.manager})`,
        );
      });
    });

    it('владелец ДРУГОГО поставщика не может тронуть чужой RFQ', async () => {
      await scenario(async (tx, w) => {
        await asUser(tx, w.supplierS2.owner);
        await expectRejected(
          tx,
          /RFQ не принадлежит вашей компании/,
          () => tx`select public.assign_supplier_rfq(${w.supplierS1.rfq}, ${w.supplierS2.owner})`,
        );
        await asOwner(tx);
        const [r] =
          await tx`select assigned_supplier_user_id from rfqs where id = ${w.supplierS1.rfq}`;
        expect(r?.assigned_supplier_user_id).toBeNull();
      });
    });

    it('назначить можно только сотрудника своей компании', async () => {
      await scenario(async (tx, w) => {
        await asUser(tx, w.supplierS1.owner);
        await expectRejected(
          tx,
          /Сотрудник не найден или отключён/,
          () => tx`select public.assign_supplier_rfq(${w.supplierS1.rfq}, ${w.supplierS2.owner})`,
        );
      });
    });

    it('anon не может вызвать функцию вовсе', async () => {
      await scenario(async (tx, w) => {
        await asAnon(tx);
        await expectRejected(
          tx,
          /permission denied/,
          () => tx`select public.assign_supplier_rfq(${w.supplierS1.rfq}, ${w.supplierS1.manager})`,
        );
      });
    });
  });

  describe('request_supplier_quote_revision', () => {
    const NOTE = 'Уточните цену за единицу';

    async function quote(tx: postgres.TransactionSql, w: World) {
      await asOwner(tx);
      await tx`update rfqs set status = 'quoted' where id = ${w.supplierS1.rfq}`;
    }

    it('сотрудник просит исправить КП: флаг ставится, письмо уходит только своему поставщику', async () => {
      await scenario(async (tx, w) => {
        await quote(tx, w);
        await asUser(tx, w.conciergeUser);
        await tx`select public.request_supplier_quote_revision(${w.supplierS1.rfq}, ${NOTE})`;
        await asOwner(tx);
        const [r] = await tx`select revision_requested from rfqs where id = ${w.supplierS1.rfq}`;
        expect(r?.revision_requested).toBe(true);
        const mail = await tx`select recipient from outbox where kind = 'rfq_revision_requested'
          and payload->>'rfqId' = ${w.supplierS1.rfq}`;
        const recipients = mail.map((m) => m.recipient as string);
        expect(recipients).toContain(`${w.supplierS1.owner}@example.test`);
        expect(recipients).not.toContain(`${w.supplierS2.owner}@example.test`);
      });
    });

    it.each([
      ['покупатель', (w: World) => w.buyerA.owner],
      ['поставщик', (w: World) => w.supplierS1.owner],
    ])('«%s» не может запросить исправление', async (_name, actor) => {
      await scenario(async (tx, w) => {
        await quote(tx, w);
        await asUser(tx, actor(w));
        await expectRejected(
          tx,
          /может только сотрудник QAJET/,
          () => tx`select public.request_supplier_quote_revision(${w.supplierS1.rfq}, ${NOTE})`,
        );
        await asOwner(tx);
        const [r] = await tx`select revision_requested from rfqs where id = ${w.supplierS1.rfq}`;
        expect(r?.revision_requested).toBe(false);
      });
    });

    it('слишком короткая причина и RFQ без отправленного КП отклоняются', async () => {
      await scenario(async (tx, w) => {
        await quote(tx, w);
        await asUser(tx, w.conciergeUser);
        await expectRejected(
          tx,
          /от 5 до 2000 символов/,
          () => tx`select public.request_supplier_quote_revision(${w.supplierS1.rfq}, ${'да'})`,
        );
      });
      await scenario(async (tx, w) => {
        await asUser(tx, w.conciergeUser);
        await expectRejected(
          tx,
          /только для уже отправленного КП/,
          () => tx`select public.request_supplier_quote_revision(${w.supplierS1.rfq}, ${NOTE})`,
        );
      });
    });

    it('anon не может вызвать функцию вовсе', async () => {
      await scenario(async (tx, w) => {
        await asAnon(tx);
        await expectRejected(
          tx,
          /permission denied/,
          () => tx`select public.request_supplier_quote_revision(${w.supplierS1.rfq}, ${NOTE})`,
        );
      });
    });
  });

  describe('decline_supplier_rfq', () => {
    it('поставщик отказывается от своего RFQ', async () => {
      await scenario(async (tx, w) => {
        await asUser(tx, w.supplierS1.owner);
        await tx`select public.decline_supplier_rfq(${w.supplierS1.rfq})`;
        await asOwner(tx);
        const [r] = await tx`select status from rfqs where id = ${w.supplierS1.rfq}`;
        expect(r?.status).toBe('declined');
      });
    });

    it.each([
      ['покупатель', (w: World) => w.buyerA.owner],
      ['консьерж', (w: World) => w.conciergeUser],
    ])('«%s» не может отказаться от RFQ за поставщика', async (_name, actor) => {
      await scenario(async (tx, w) => {
        await asUser(tx, actor(w));
        await expectRejected(
          tx,
          /Только поставщик может отказаться/,
          () => tx`select public.decline_supplier_rfq(${w.supplierS1.rfq})`,
        );
        await asOwner(tx);
        const [r] = await tx`select status from rfqs where id = ${w.supplierS1.rfq}`;
        expect(r?.status).toBe('sent');
      });
    });

    it('другой поставщик не может отказаться от чужого RFQ', async () => {
      await scenario(async (tx, w) => {
        await asUser(tx, w.supplierS2.owner);
        await expectRejected(
          tx,
          /RFQ недоступен, просрочен или уже закрыт/,
          () => tx`select public.decline_supplier_rfq(${w.supplierS1.rfq})`,
        );
        await asOwner(tx);
        const [r] = await tx`select status from rfqs where id = ${w.supplierS1.rfq}`;
        expect(r?.status).toBe('sent');
      });
    });

    it('закрытый и просроченный RFQ отклоняются', async () => {
      await scenario(async (tx, w) => {
        await asOwner(tx);
        await tx`update rfqs set status = 'quoted' where id = ${w.supplierS1.rfq}`;
        await asUser(tx, w.supplierS1.owner);
        await expectRejected(
          tx,
          /RFQ недоступен, просрочен или уже закрыт/,
          () => tx`select public.decline_supplier_rfq(${w.supplierS1.rfq})`,
        );
      });
      await scenario(async (tx, w) => {
        await asOwner(tx);
        await tx`update rfqs set respond_by = '2020-01-01T00:00:00Z' where id = ${w.supplierS1.rfq}`;
        await asUser(tx, w.supplierS1.owner);
        await expectRejected(
          tx,
          /RFQ недоступен, просрочен или уже закрыт/,
          () => tx`select public.decline_supplier_rfq(${w.supplierS1.rfq})`,
        );
      });
    });

    it('anon не может вызвать функцию вовсе', async () => {
      await scenario(async (tx, w) => {
        await asAnon(tx);
        await expectRejected(
          tx,
          /permission denied/,
          () => tx`select public.decline_supplier_rfq(${w.supplierS1.rfq})`,
        );
      });
    });
  });

  describe('orders.approved_plan_id: инвариант живёт в самой БД, а не в RPC', () => {
    const INTERNAL = /Покупатель не может менять внутренние поля заказа/;
    type Tx = postgres.TransactionSql;

    const repoint = (tx: Tx, planId: string, orderId: string) =>
      tx`update orders set approved_plan_id = ${planId} where id = ${orderId}`;

    async function pointerOf(tx: Tx, orderId: string) {
      await asOwner(tx);
      const [o] = await tx`select approved_plan_id from orders where id = ${orderId}`;
      return o?.approved_plan_id as string | undefined;
    }

    /** Стадию ставим в обход переходов: нужен только фон для проверки сторожа. */
    async function setState(tx: Tx, orderId: string, state: string) {
      await asOwner(tx);
      await tx`alter table orders disable trigger user`;
      await tx`update orders set state = ${state} where id = ${orderId}`;
      await tx`alter table orders enable trigger user`;
    }

    it('прямая правка допустима на proposed-план ТОЙ ЖЕ заявки в plan_proposed', async () => {
      await scenario(async (tx, w) => {
        await asUser(tx, w.buyerA.owner);
        await repoint(tx, w.buyerA.planB, w.buyerA.order);
        expect(await pointerOf(tx, w.buyerA.order)).toBe(w.buyerA.planB);
      });
    });

    it('и в awaiting_internal_approval', async () => {
      await scenario(async (tx, w) => {
        await setState(tx, w.buyerA.order, 'awaiting_internal_approval');
        await asUser(tx, w.buyerA.owner);
        await repoint(tx, w.buyerA.planB, w.buyerA.order);
        expect(await pointerOf(tx, w.buyerA.order)).toBe(w.buyerA.planB);
      });
    });

    it('план из чужой заявки подставить нельзя даже прямой правкой', async () => {
      await scenario(async (tx, w) => {
        await asUser(tx, w.buyerA.owner);
        await expectRejected(tx, INTERNAL, () => repoint(tx, w.otherRequestPlan, w.buyerA.order));
        expect(await pointerOf(tx, w.buyerA.order)).toBe(w.buyerA.planA);
      });
    });

    it.each([['superseded'], ['draft']])(
      'план в статусе %s подставить нельзя (заглушка приёма не должна становиться выбором)',
      async (status) => {
        await scenario(async (tx, w) => {
          await asOwner(tx);
          await tx`update plans set status = ${status} where id = ${w.buyerA.planB}`;
          await asUser(tx, w.buyerA.owner);
          await expectRejected(tx, INTERNAL, () => repoint(tx, w.buyerA.planB, w.buyerA.order));
          expect(await pointerOf(tx, w.buyerA.order)).toBe(w.buyerA.planA);
        });
      },
    );

    it.each([['rfq_sent'], ['quotes_received'], ['plan_approved']])(
      'в стадии %s указатель не двигается',
      async (state) => {
        await scenario(async (tx, w) => {
          await setState(tx, w.buyerA.order, state);
          await asUser(tx, w.buyerA.owner);
          await expectRejected(tx, INTERNAL, () => repoint(tx, w.buyerA.planB, w.buyerA.order));
          expect(await pointerOf(tx, w.buyerA.order)).toBe(w.buyerA.planA);
        });
      },
    );

    it('вместе с указателем нельзя изменить другое поле заказа', async () => {
      await scenario(async (tx, w) => {
        await asUser(tx, w.buyerA.owner);
        await expectRejected(
          tx,
          INTERNAL,
          () =>
            tx`update orders set approved_plan_id = ${w.buyerA.planB}, concierge_user_id = ${w.buyerA.owner}
              where id = ${w.buyerA.order}`,
        );
        expect(await pointerOf(tx, w.buyerA.order)).toBe(w.buyerA.planA);
      });
    });

    it('перенаправление вместе со сменой стадии в одной правке отклоняется', async () => {
      await scenario(async (tx, w) => {
        await asUser(tx, w.buyerA.owner);
        await expectRejected(
          tx,
          INTERNAL,
          () =>
            tx`update orders set state = 'awaiting_internal_approval', approved_plan_id = ${w.buyerA.planB}
              where id = ${w.buyerA.order}`,
        );
        await asOwner(tx);
        const [o] =
          await tx`select state, approved_plan_id from orders where id = ${w.buyerA.order}`;
        expect(o?.state).toBe('plan_proposed');
        expect(o?.approved_plan_id).toBe(w.buyerA.planA);
      });
    });

    it('покупатель другой компании и поставщик не находят заказ для правки (0 строк, без исключения)', async () => {
      for (const actor of [(w: World) => w.buyerB.owner, (w: World) => w.supplierS1.owner]) {
        await scenario(async (tx, w) => {
          await asUser(tx, actor(w));
          const changed = await repoint(tx, w.buyerA.planB, w.buyerA.order);
          expect(changed.count).toBe(0);
          expect(await pointerOf(tx, w.buyerA.order)).toBe(w.buyerA.planA);
        });
      }
    });

    it('сотрудник QAJET по-прежнему может менять указатель — это не изменилось и закреплено', async () => {
      await scenario(async (tx, w) => {
        await asUser(tx, w.conciergeUser);
        const changed = await repoint(tx, w.buyerA.planB, w.buyerA.order);
        expect(changed.count).toBe(1);
        expect(await pointerOf(tx, w.buyerA.order)).toBe(w.buyerA.planB);
      });
    });

    it('перенаправление переносит видимость заказа между поставщиками и не открывает чужих строк плана', async () => {
      await scenario(async (tx, w) => {
        const visible = async (actor: string) => {
          await asUser(tx, actor);
          const orders = await tx`select id from orders where id = ${w.buyerA.order}`;
          const lines = await tx`select id from plan_lines order by id`;
          return { sawOrder: orders.length === 1, lines: lines.map((l) => l.id as string) };
        };

        // Поставщик видит заказ и только свою строку, пока выбран его план; иначе — ничего.
        expect(await visible(w.supplierS1.owner)).toEqual({ sawOrder: true, lines: [w.lineA] });
        expect(await visible(w.supplierS2.owner)).toEqual({ sawOrder: false, lines: [] });

        await asUser(tx, w.buyerA.owner);
        await tx`select public.select_order_plan(${w.buyerA.order}, ${w.buyerA.planA}, ${w.buyerA.planB})`;

        // После перенаправления — наоборот. Чужая строка плана не видна ни в одном состоянии.
        expect(await visible(w.supplierS1.owner)).toEqual({ sawOrder: false, lines: [] });
        expect(await visible(w.supplierS2.owner)).toEqual({ sawOrder: true, lines: [w.lineB] });
      });
    });

    describe('смена варианта попадает в аудит (находка P3)', () => {
      /**
       * Внутри одной транзакции now() одинаков у всех строк, поэтому сортировать
       * события по времени бессмысленно: записи ищутся по содержимому заметки.
       */
      const repointEvents = async (tx: Tx, orderId: string) => {
        await asOwner(tx);
        return tx`select from_state, to_state, actor_user_id, note
          from order_stage_events
          where order_id = ${orderId} and note like 'Выбран другой вариант%'`;
      };

      it('выбор другого варианта оставляет запись с обоими вариантами и автором', async () => {
        await scenario(async (tx, w) => {
          expect(await repointEvents(tx, w.buyerA.order)).toHaveLength(0);

          await asUser(tx, w.buyerA.owner);
          await tx`select public.select_order_plan(${w.buyerA.order}, ${w.buyerA.planA}, ${w.buyerA.planB})`;

          const events = await repointEvents(tx, w.buyerA.order);
          expect(events, 'ровно одна запись на одно переключение').toHaveLength(1);

          const row = events[0];
          expect(row?.actor_user_id, 'автор — покупатель, а не служебная роль').toBe(
            w.buyerA.owner,
          );
          // Без обоих вариантов по журналу не восстановить, с чего на что перешли.
          expect(String(row?.note)).toContain('recommended');
          expect(String(row?.note)).toContain('cheaper');
          // Это решение внутри стадии, а не переход между стадиями.
          expect(row?.from_state).toBe(row?.to_state);
        });
      });

      it('прямая правка указателя покупателем тоже записывается', async () => {
        await scenario(async (tx, w) => {
          await asUser(tx, w.buyerA.owner);
          await repoint(tx, w.buyerA.planB, w.buyerA.order);
          expect(await repointEvents(tx, w.buyerA.order)).toHaveLength(1);
        });
      });

      it('запись того же варианта поверх себя не создаёт события', async () => {
        await scenario(async (tx, w) => {
          await asUser(tx, w.buyerA.owner);
          await repoint(tx, w.buyerA.planA, w.buyerA.order);
          expect(
            await repointEvents(tx, w.buyerA.order),
            'указатель не изменился — записывать нечего',
          ).toHaveLength(0);
        });
      });
    });
  });

  describe('треды поставщиков после смены плана (ревью Codex к PR #15)', () => {
    type Tx = postgres.TransactionSql;
    const threadsSeenBy = async (tx: Tx, actor: string, orderId: string) => {
      await asUser(tx, actor);
      const rows =
        await tx`select id from threads where order_id = ${orderId} and kind = 'supplier'`;
      return rows.length;
    };

    it('поставщик, выпавший из выбранного плана, теряет тред заказа — в том числе владелец компании', async () => {
      await scenario(async (tx, w) => {
        // Контроль: пока план S1 выбран, владелец S1 свой тред видит, а S2 — нет.
        expect(await threadsSeenBy(tx, w.supplierS1.owner, w.buyerA.order)).toBe(1);
        expect(await threadsSeenBy(tx, w.supplierS2.owner, w.buyerA.order)).toBe(0);

        await asUser(tx, w.buyerA.owner);
        await tx`select public.select_order_plan(${w.buyerA.order}, ${w.buyerA.planA}, ${w.buyerA.planB})`;

        // План B выбран: S1 в нём нет — доступа к беседе быть не должно.
        expect(await threadsSeenBy(tx, w.supplierS1.owner, w.buyerA.order)).toBe(0);
        expect(await threadsSeenBy(tx, w.supplierS2.owner, w.buyerA.order)).toBe(1);
      });
    });

    it('возврат A → B → A возвращает доступ S1 и снова закрывает S2', async () => {
      await scenario(async (tx, w) => {
        await asUser(tx, w.buyerA.owner);
        await tx`select public.select_order_plan(${w.buyerA.order}, ${w.buyerA.planA}, ${w.buyerA.planB})`;
        await tx`select public.select_order_plan(${w.buyerA.order}, ${w.buyerA.planB}, ${w.buyerA.planA})`;

        expect(await threadsSeenBy(tx, w.supplierS1.owner, w.buyerA.order)).toBe(1);
        expect(await threadsSeenBy(tx, w.supplierS2.owner, w.buyerA.order)).toBe(0);
      });
    });

    it('выпавший поставщик не может писать в свой прежний тред', async () => {
      await scenario(async (tx, w) => {
        await asOwner(tx);
        const [thread] =
          await tx`select id from threads where order_id = ${w.buyerA.order} and supplier_company_id = ${w.supplierS1.company}`;
        expect(thread, 'тред S1 создан вместе с заказом').toBeTruthy();

        await asUser(tx, w.buyerA.owner);
        await tx`select public.select_order_plan(${w.buyerA.order}, ${w.buyerA.planA}, ${w.buyerA.planB})`;

        await asUser(tx, w.supplierS1.owner);
        await expectRejected(
          tx,
          /row-level security/,
          () =>
            tx`insert into messages (thread_id, author_user_id, body) values (${thread?.id}, ${w.supplierS1.owner}, 'ещё здесь?')`,
        );
        const seen = await tx`select id from messages where thread_id = ${thread?.id}`;
        expect(seen).toHaveLength(0);
      });
    });
  });
});
