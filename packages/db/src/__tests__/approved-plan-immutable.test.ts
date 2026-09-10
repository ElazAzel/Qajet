import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

/**
 * §15: «изменение утверждённого плана создаёт новую версию, а не правит
 * заказ». Проверяются триггеры `enforce_approved_plan_immutable` и
 * `enforce_approved_plan_lines_immutable` (миграция 0016).
 *
 * До них правило жило только в приложении (`PLAN_EDITABLE_STATES`,
 * apps/web/app/lib/order-state.ts), а политики `plans_update_staff` и
 * `plan_lines_update_staff` позволяли staff-сессии переписать суммы уже
 * утверждённого плана напрямую через PostgREST — то есть поменять цену
 * задним числом после согласия покупателя.
 *
 * Тест идёт под ролью staff (концьерж) намеренно: именно у неё есть
 * политика UPDATE, и именно её должен останавливать триггер. Проверять
 * запрет для покупателя было бы проверкой RLS, а не этого барьера.
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

describeIfConfigured('Утверждённый план неизменяем (§15)', () => {
  it('staff не может переписать суммы и строки утверждённого плана, но может пометить его superseded', async () => {
    const admin = postgres(DATABASE_URL as string, { prepare: false });

    try {
      const buyerCompany = one(
        await admin<{ id: string }[]>`
          insert into companies (type, name) values ('buyer', 'Immutable Plan Buyer') returning id
        `,
      );
      const supplierCompany = one(
        await admin<{ id: string }[]>`
          insert into companies (type, name) values ('supplier', 'Immutable Plan Supplier') returning id
        `,
      );
      const authBuyer = await insertAuthUser(admin, 'rls-test-immutable-buyer@example.com');
      await admin`
        insert into public.users (id, company_id, email, full_name, role)
        values (${authBuyer.id}, ${buyerCompany.id}, 'rls-test-immutable-buyer@example.com', 'Buyer', 'owner')
      `;
      const authConcierge = await insertAuthUser(admin, 'rls-test-immutable-concierge@example.com');
      await admin`
        insert into public.users (id, company_id, email, full_name, role)
        values (${authConcierge.id}, null, 'rls-test-immutable-concierge@example.com', 'Concierge', 'concierge')
      `;

      const request = one(
        await admin<{ id: string }[]>`
          insert into requests (buyer_company_id, created_by, title, raw_text)
          values (${buyerCompany.id}, ${authBuyer.id}, 'Immutable', 'raw')
          returning id
        `,
      );
      const item = one(
        await admin<{ id: string }[]>`
          insert into request_items (request_id, name, category, qty, unit)
          values (${request.id}, 'Позиция', 'merch', 10, 'шт')
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
      const approvedPlan = one(
        await admin<{ id: string }[]>`
          insert into plans (
            request_id, version, kind, total_supplier_kzt, delivery_kzt,
            commission_kzt, commission_base, total_kzt, supplier_count, explanation, status
          ) values (
            ${request.id}, 1, 'recommended', 100000, 5000,
            23000, 'supplier_ex_delivery', 128000, 1, '{}'::jsonb, 'approved'
          )
          returning id
        `,
      );
      // Строка плана заводится под service_role/postgres — эта роль
      // намеренно проходит мимо триггера (иначе сид, который вставляет
      // approved-план и его строки двумя запросами, был бы невозможен).
      await admin`
        insert into plan_lines (
          plan_id, request_item_id, supplier_company_id, quote_line_id,
          qty, line_total_kzt, commission_pct, commission_kzt
        ) values (
          ${approvedPlan.id}, ${item.id}, ${supplierCompany.id}, ${quoteLine.id},
          10, 100000, 23, 23000
        )
      `;

      const asConcierge = postgres(DATABASE_URL as string, {
        prepare: false,
        connection: { options: '-c role=authenticated' },
      });

      try {
        await expect(
          asConcierge.begin(async (tx) => {
            await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: authConcierge.id, role: 'authenticated' })}, true)`;
            await tx`update plans set total_kzt = total_kzt + 1000 where id = ${approvedPlan.id}`;
          }),
        ).rejects.toThrow(/Утверждённый план изменять нельзя/);

        await expect(
          asConcierge.begin(async (tx) => {
            await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: authConcierge.id, role: 'authenticated' })}, true)`;
            await tx`update plan_lines set line_total_kzt = line_total_kzt + 1 where plan_id = ${approvedPlan.id}`;
          }),
        ).rejects.toThrow(/Строки утверждённого плана изменять нельзя/);

        // Добавить строку — тоже изменение состава плана. Первая версия
        // триггера висела только на UPDATE/DELETE, и этот путь был открыт.
        await expect(
          asConcierge.begin(async (tx) => {
            await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: authConcierge.id, role: 'authenticated' })}, true)`;
            await tx`
              insert into plan_lines (
                plan_id, request_item_id, supplier_company_id, quote_line_id,
                qty, line_total_kzt, commission_pct, commission_kzt
              ) values (
                ${approvedPlan.id}, ${item.id}, ${supplierCompany.id}, ${quoteLine.id},
                1, 10000, 23, 2300
              )
            `;
          }),
        ).rejects.toThrow(/Строки утверждённого плана изменять нельзя/);

        // Снять защиту в два запроса (approved → draft, затем правка сумм)
        // тоже нельзя: выход из approved разрешён только в superseded.
        await expect(
          asConcierge.begin(async (tx) => {
            await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: authConcierge.id, role: 'authenticated' })}, true)`;
            await tx`update plans set status = 'draft' where id = ${approvedPlan.id}`;
          }),
        ).rejects.toThrow(/можно только пометить superseded/);

        // Ничего не поменялось на самом деле, а не только «запрос упал».
        const unchanged = one(
          await admin<{ total_kzt: string }[]>`
            select total_kzt from plans where id = ${approvedPlan.id}
          `,
        );
        expect(Number(unchanged.total_kzt)).toBe(128000);

        // Пометить план устаревшим — разрешено: именно так выглядит
        // «создать новую версию вместо правки».
        await asConcierge.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: authConcierge.id, role: 'authenticated' })}, true)`;
          await tx`update plans set status = 'superseded' where id = ${approvedPlan.id}`;
        });
        const superseded = one(
          await admin<{ status: string }[]>`
            select status from plans where id = ${approvedPlan.id}
          `,
        );
        expect(superseded.status).toBe('superseded');
      } finally {
        await asConcierge.end();
      }

      // Уборка. Первая версия триггера отменяла DELETE любой строки плана
      // (возвращала NEW, а на DELETE это NULL) — эта уборка проходит только
      // потому, что service_role/postgres триггер пропускает, а на DELETE
      // возвращается OLD.
      await admin`delete from plan_lines where plan_id = ${approvedPlan.id}`;
      await admin`delete from plans where id = ${approvedPlan.id}`;
      await admin`delete from quote_lines where id = ${quoteLine.id}`;
      await admin`delete from quotes where id = ${quote.id}`;
      await admin`delete from rfqs where id = ${rfq.id}`;
      await admin`delete from request_items where id = ${item.id}`;
      await admin`delete from requests where id = ${request.id}`;
      await admin`delete from public.users where id in (${authBuyer.id}, ${authConcierge.id})`;
      await admin`delete from auth.users where id in (${authBuyer.id}, ${authConcierge.id})`;
      await admin`delete from companies where id in (${buyerCompany.id}, ${supplierCompany.id})`;
    } finally {
      await admin.end();
    }
  });
});
