import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

/**
 * Комиссия по позиции плана (agents.md §7, задача «комиссия платформы»):
 * request_items_update_staff теперь есть и на plan_lines (commission_pct/
 * commission_kzt), а сама таблица сужена до staff-only SELECT — было
 * `planId in (select id from plans)`, что отдавало buyer-сессии всю
 * plan_lines целиком (включая supplier_company_id, нарушение ADR-0009),
 * раз plans видна и покупателю. Заодно проверяет approve_plan() RPC,
 * который заменил plans_update_buyer_own (снятую отдельно из-за
 * отсутствия колоночного ограничения — buyer мог бы UPDATE
 * commission_kzt/total_kzt в своём же плане напрямую).
 *
 * `set_config(..., true)` — LOCAL, требует sql.begin() в одной транзакции
 * с последующими запросами — тот же приём и та же на практике найденная
 * ошибка (P1 в supplier-isolation.test.ts), что и в остальных RLS-тестах
 * этого пакета.
 *
 * Требует DATABASE_URL — см. supplier-isolation.test.ts.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfConfigured = DATABASE_URL ? describe : describe.skip;

function one<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) {
    throw new Error('Ожидалась хотя бы одна строка из фикстуры, получено 0.');
  }
  return row;
}

async function approvePlan(tx: postgres.TransactionSql, orderId: string) {
  const plan = (
    await tx<{ id: string; version: number }[]>`
      select p.id, p.version
      from orders o
      join lateral public.get_buyer_plans(ARRAY[o.request_id]) p on p.id = o.approved_plan_id
      where o.id = ${orderId}
    `
  )[0];
  if (!plan) throw new Error('Тестовая фикстура не содержит план заказа.');
  // Approval returns no backing row. Assert its result through the buyer DTO,
  // under the same buyer role rather than resetting RLS for the assertion.
  await tx`select approve_plan(${orderId}, ${plan.id}, ${plan.version})`;
  return tx<{ id: string; status: string }[]>`
    select p.id, p.status from orders o
    join lateral public.get_buyer_plans(ARRAY[o.request_id]) p on p.id = o.approved_plan_id
    where o.id = ${orderId}
  `;
}

async function insertAuthUser(admin: postgres.Sql, email: string): Promise<{ id: string }> {
  return one(
    await admin<{ id: string }[]>`
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change, email_change_token_new,
        email_change_token_current, phone_change, phone_change_token, reauthentication_token
      ) values (
        '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
        ${email}, crypt('test-password', gen_salt('bf')), now(),
        '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', ''
      ) returning id
    `,
  );
}

describeIfConfigured('комиссия по позиции плана (RLS + approve_plan RPC)', () => {
  it('консьерж может править commission_pct, покупатель не видит plan_lines и не может UPDATE plans напрямую', async () => {
    const admin = postgres(DATABASE_URL as string, { prepare: false });

    try {
      const buyerCompany = one(
        await admin<{ id: string }[]>`
          insert into companies (type, name) values ('buyer', 'Test Buyer Co') returning id
        `,
      );
      const supplierCompany = one(
        await admin<{ id: string }[]>`
          insert into companies (type, name) values ('supplier', 'Test Supplier Co') returning id
        `,
      );
      const otherBuyerCompany = one(
        await admin<{ id: string }[]>`
          insert into companies (type, name) values ('buyer', 'Other Buyer Co') returning id
        `,
      );

      const authBuyer = await insertAuthUser(admin, 'rls-test-plan-buyer@example.com');
      await admin`
        insert into public.users (id, company_id, email, full_name, role)
        values (${authBuyer.id}, ${buyerCompany.id}, 'rls-test-plan-buyer@example.com', 'Test Buyer', 'owner')
      `;
      const authOtherBuyer = await insertAuthUser(admin, 'rls-test-plan-other-buyer@example.com');
      await admin`
        insert into public.users (id, company_id, email, full_name, role)
        values (${authOtherBuyer.id}, ${otherBuyerCompany.id}, 'rls-test-plan-other-buyer@example.com', 'Other Buyer', 'owner')
      `;
      const authConcierge = await insertAuthUser(admin, 'rls-test-plan-concierge@example.com');
      await admin`
        insert into public.users (id, company_id, email, full_name, role)
        values (${authConcierge.id}, null, 'rls-test-plan-concierge@example.com', 'Test Concierge', 'concierge')
      `;

      const request = one(
        await admin<{ id: string }[]>`
          insert into requests (buyer_company_id, created_by, title, raw_text)
          values (${buyerCompany.id}, ${authBuyer.id}, 'Test', 'raw')
          returning id
        `,
      );
      const item = one(
        await admin<{ id: string }[]>`
          insert into request_items (request_id, name, category, qty, unit)
          values (${request.id}, 'Item', 'merch', 10, 'шт')
          returning id
        `,
      );
      const rfq = one(
        await admin<{ id: string }[]>`
          insert into rfqs (request_id, supplier_company_id, token)
          values (${request.id}, ${supplierCompany.id}, ${`tok-${crypto.randomUUID()}`})
          returning id
        `,
      );
      const quote = one(
        await admin<{ id: string }[]>`insert into quotes (rfq_id) values (${rfq.id}) returning id`,
      );
      const quoteLine = one(
        await admin<{ id: string }[]>`
          insert into quote_lines (quote_id, request_item_id, unit_price_kzt, lead_time_days)
          values (${quote.id}, ${item.id}, 10000, 5)
          returning id
        `,
      );
      const plan = one(
        await admin<{ id: string }[]>`
          insert into plans (
            request_id, version, kind, total_supplier_kzt, delivery_kzt,
            commission_kzt, commission_base, total_kzt, supplier_count, explanation, status
          ) values (
            ${request.id}, 1, 'recommended', 100000, 5000,
            23000, 'supplier_ex_delivery', 128000, 1, '{}'::jsonb, 'proposed'
          )
          returning id
        `,
      );
      const planLine = one(
        await admin<{ id: string }[]>`
          insert into plan_lines (
            plan_id, request_item_id, supplier_company_id, quote_line_id,
            qty, line_total_kzt, commission_pct, commission_kzt
          ) values (
            ${plan.id}, ${item.id}, ${supplierCompany.id}, ${quoteLine.id},
            10, 100000, 23, 23000
          )
          returning id
        `,
      );
      const order = one(
        await admin<{ id: string }[]>`
          insert into orders (request_id, approved_plan_id, state, concierge_user_id)
          values (${request.id}, ${plan.id}, 'plan_proposed', ${authConcierge.id})
          returning id
        `,
      );

      const asBuyer = postgres(DATABASE_URL as string, {
        prepare: false,
        connection: { options: '-c role=authenticated' },
      });
      const asOtherBuyer = postgres(DATABASE_URL as string, {
        prepare: false,
        connection: { options: '-c role=authenticated' },
      });
      const asConcierge = postgres(DATABASE_URL as string, {
        prepare: false,
        connection: { options: '-c role=authenticated' },
      });

      try {
        // Покупатель не видит plan_lines вовсе — раньше видел всю строку,
        // включая supplier_company_id (нарушение ADR-0009).
        const buyerSelect = await asBuyer.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: authBuyer.id, role: 'authenticated' })}, true)`;
          return tx<{ id: string }[]>`select id from plan_lines where id = ${planLine.id}`;
        });
        expect(buyerSelect).toHaveLength(0);

        // Покупатель не может UPDATE commission_pct на plan_lines.
        const buyerUpdateLine = await asBuyer.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: authBuyer.id, role: 'authenticated' })}, true)`;
          return tx<{ id: string }[]>`
            update plan_lines set commission_pct = 21 where id = ${planLine.id} returning id
          `;
        });
        expect(buyerUpdateLine).toHaveLength(0);

        // Покупатель не может UPDATE plans напрямую — plans_update_buyer_own
        // снята, остался только staffOnly и approve_plan() RPC.
        const buyerUpdatePlan = await asBuyer.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: authBuyer.id, role: 'authenticated' })}, true)`;
          return tx<{ id: string }[]>`
            update plans set commission_kzt = 999999 where id = ${plan.id} returning id
          `;
        });
        expect(buyerUpdatePlan).toHaveLength(0);

        // Консьерж может UPDATE commission_pct/commission_kzt на plan_lines.
        const conciergeUpdateLine = await asConcierge.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: authConcierge.id, role: 'authenticated' })}, true)`;
          return tx<{ id: string; commission_pct: number; commission_kzt: string }[]>`
            update plan_lines set commission_pct = 21, commission_kzt = 21000
            where id = ${planLine.id}
            returning id, commission_pct, commission_kzt
          `;
        });
        expect(conciergeUpdateLine).toHaveLength(1);
        expect(conciergeUpdateLine[0]?.commission_pct).toBe(21);
        // postgres.js возвращает bigint как строку (защита от потери
        // точности за пределами Number.MAX_SAFE_INTEGER) — приводим явно.
        expect(Number(conciergeUpdateLine[0]?.commission_kzt)).toBe(21000);

        // Чужой покупатель (не владелец заявки) не может утвердить план.
        const otherBuyerApprove = await asOtherBuyer
          .begin(async (tx) => {
            await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: authOtherBuyer.id, role: 'authenticated' })}, true)`;
            return approvePlan(tx, order.id);
          })
          .catch(() => null);
        expect(otherBuyerApprove).toBeNull();

        // Покупатель-владелец может утвердить план через RPC — статус меняется.
        const buyerApprove = await asBuyer.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: authBuyer.id, role: 'authenticated' })}, true)`;
          return approvePlan(tx, order.id);
        });
        expect(buyerApprove).toHaveLength(1);
        expect(buyerApprove[0]?.status).toBe('approved');
      } finally {
        await asBuyer.end();
        await asOtherBuyer.end();
        await asConcierge.end();
      }

      // Уборка.
      await admin`delete from orders where id = ${order.id}`;
      await admin`delete from plan_lines where id = ${planLine.id}`;
      await admin`delete from plans where id = ${plan.id}`;
      await admin`delete from quote_lines where id = ${quoteLine.id}`;
      await admin`delete from quotes where id = ${quote.id}`;
      await admin`delete from rfqs where id = ${rfq.id}`;
      await admin`delete from request_items where id = ${item.id}`;
      await admin`delete from requests where id = ${request.id}`;
      await admin`delete from public.users where id in (${authBuyer.id}, ${authOtherBuyer.id}, ${authConcierge.id})`;
      await admin`delete from auth.users where id in (${authBuyer.id}, ${authOtherBuyer.id}, ${authConcierge.id})`;
      await admin`delete from companies where id in (${buyerCompany.id}, ${supplierCompany.id}, ${otherBuyerCompany.id})`;
    } finally {
      await admin.end();
    }
  });
});
