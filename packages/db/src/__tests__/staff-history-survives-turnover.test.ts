import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

/**
 * agents.md §10: покупателю личность исполнителя не раскрывается, но
 * консьерж/админ должны сохранять ПОЛНУЮ историю «кто поставлял куда» — и
 * эта видимость обязана пережить смену/деактивацию конкретного консьержа,
 * который вёл заказ (staff-роль будет меняться людьми).
 *
 * Два факта проверяются здесь через реальный RLS (impersonation через
 * request.jwt.claims — см. supplier-isolation.test.ts), а не через доверие
 * к тому, что приложение само не сделает запрещённый запрос:
 *
 * 1. Заказ ведёт concierge A (orders.concierge_user_id = A). Другой,
 *    никак не связанный с этим заказом concierge B видит и сам заказ, и
 *    его RFQ (включая supplier_company_id — «кто поставлял»), и
 *    order_stage_events — потому что видимость staffOnly ролевая
 *    (current_role() in ('concierge','admin')), а не завязана на
 *    concierge_user_id/actor_user_id этого конкретного заказа.
 * 2. Деактивация — единственный физически возможный способ «убрать»
 *    консьержа, который уже что-то сделал: order_stage_events.actor_user_id
 *    references users(restrict) не даёт его удалить. После is_active=false
 *    у A current_role() больше не возвращает 'concierge' (миграция
 *    0008_deactivated_staff_lose_access) — A теряет staffOnly-доступ,
 *    но concierge B по-прежнему видит всё: история не привязана к
 *    персоне, ушедший сотрудник не может продолжать её читать.
 *
 * `set_config(..., true)` — LOCAL, живёт только до конца ТЕКУЩЕЙ
 * транзакции: без явного sql.begin() каждый отдельный тег-вызов
 * postgres.js — своя неявная транзакция, auth.uid() снова null уже на
 * следующем запросе. Тот же приём, что в packages/pd/src/postgres-backend.ts.
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

function openSession(databaseUrl: string): postgres.Sql {
  return postgres(databaseUrl, {
    prepare: false,
    connection: { options: '-c role=authenticated' },
  });
}

describeIfConfigured('история заказа переживает смену/деактивацию консьержа (RLS)', () => {
  it('другой консьерж видит заказ и RFQ; деактивированный — больше нет', async () => {
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

      const authConciergeA = await insertAuthUser(admin, 'rls-test-concierge-a@example.com');
      await admin`
        insert into public.users (id, company_id, email, full_name, role)
        values (${authConciergeA.id}, null, 'rls-test-concierge-a@example.com', 'Concierge A', 'concierge')
      `;
      const authConciergeB = await insertAuthUser(admin, 'rls-test-concierge-b@example.com');
      await admin`
        insert into public.users (id, company_id, email, full_name, role)
        values (${authConciergeB.id}, null, 'rls-test-concierge-b@example.com', 'Concierge B', 'concierge')
      `;

      const request = one(
        await admin<{ id: string }[]>`
          insert into requests (buyer_company_id, created_by, title, raw_text)
          values (${buyerCompany.id}, ${authConciergeA.id}, 'Test', 'raw')
          returning id
        `,
      );
      const plan = one(
        await admin<{ id: string }[]>`
          insert into plans (
            request_id, kind, total_supplier_kzt, delivery_kzt, commission_kzt,
            commission_base, total_kzt, supplier_count, explanation, status
          )
          values (
            ${request.id}, 'recommended', 100000, 5000, 12000,
            'total_supplier_kzt', 117000, 1, '{}'::jsonb, 'approved'
          )
          returning id
        `,
      );
      const order = one(
        await admin<{ id: string }[]>`
          insert into orders (request_id, approved_plan_id, state, concierge_user_id)
          values (${request.id}, ${plan.id}, 'draft', ${authConciergeA.id})
          returning id
        `,
      );
      const rfq = one(
        await admin<{ id: string }[]>`
          insert into rfqs (request_id, supplier_company_id, token)
          values (${request.id}, ${supplierCompany.id}, ${`tok-turnover-${crypto.randomUUID()}`})
          returning id
        `,
      );
      await admin`
        insert into order_stage_events (order_id, to_state, actor_user_id)
        values (${order.id}, 'draft', ${authConciergeA.id})
      `;

      const claimsFor = (userId: string) => JSON.stringify({ sub: userId, role: 'authenticated' });

      const conciergeBSession = openSession(DATABASE_URL as string);
      try {
        const visibleOrders = await conciergeBSession.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${claimsFor(authConciergeB.id)}, true)`;
          return tx<{ id: string }[]>`select id from orders where id = ${order.id}`;
        });
        expect(visibleOrders).toHaveLength(1);

        const visibleRfqs = await conciergeBSession.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${claimsFor(authConciergeB.id)}, true)`;
          return tx<{ id: string; supplier_company_id: string }[]>`
            select id, supplier_company_id from rfqs where id = ${rfq.id}
          `;
        });
        expect(visibleRfqs).toHaveLength(1);
        expect(visibleRfqs[0]?.supplier_company_id).toBe(supplierCompany.id);

        const visibleEvents = await conciergeBSession.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${claimsFor(authConciergeB.id)}, true)`;
          return tx<
            { id: string }[]
          >`select id from order_stage_events where order_id = ${order.id}`;
        });
        expect(visibleEvents).toHaveLength(1);
      } finally {
        await conciergeBSession.end();
      }

      // Консьерж A деактивирован (agents.md §10 «Админ»: «отзыв доступа») —
      // удалить строку нельзя (order_stage_events.actor_user_id restrict),
      // единственный физически доступный путь.
      await admin`update public.users set is_active = false where id = ${authConciergeA.id}`;

      const conciergeASession = openSession(DATABASE_URL as string);
      try {
        const stillVisibleToA = await conciergeASession.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${claimsFor(authConciergeA.id)}, true)`;
          return tx<{ id: string }[]>`select id from rfqs where id = ${rfq.id}`;
        });
        expect(stillVisibleToA).toHaveLength(0);
      } finally {
        await conciergeASession.end();
      }

      // Concierge B по-прежнему видит всё — уход A не сломал историю.
      const conciergeBSessionAgain = openSession(DATABASE_URL as string);
      try {
        const stillVisibleToB = await conciergeBSessionAgain.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${claimsFor(authConciergeB.id)}, true)`;
          return tx<{ id: string }[]>`select id from rfqs where id = ${rfq.id}`;
        });
        expect(stillVisibleToB).toHaveLength(1);
      } finally {
        await conciergeBSessionAgain.end();
      }

      await admin`delete from order_stage_events where order_id = ${order.id}`;
      await admin`delete from orders where id = ${order.id}`;
      await admin`delete from rfqs where id = ${rfq.id}`;
      await admin`delete from plans where id = ${plan.id}`;
      await admin`delete from requests where id = ${request.id}`;
      await admin`delete from public.users where id in (${authConciergeA.id}, ${authConciergeB.id})`;
      await admin`delete from auth.users where id in (${authConciergeA.id}, ${authConciergeB.id})`;
      await admin`delete from companies where id in (${buyerCompany.id}, ${supplierCompany.id})`;
    } finally {
      await admin.end();
    }
  });
});
