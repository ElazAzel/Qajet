import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

/**
 * RLS для трёх новых политик задачи «дожать аудит» (agents.md §11.3,
 * §8G, §14 шаг 11): `documents_insert_via_order` (Document Engine — счёт/
 * акт пишет либо staff, либо покупатель своего же заказа),
 * `model_snapshots_insert_staff` (замыкание контура обучения — только
 * staff, чтобы произвольная authenticated-сессия не могла отравить общую
 * модель матчера/срока произвольными весами) и
 * `settings_select_public_requisites` (реквизиты QAJET — единственная
 * строка settings, видимая и покупателю, остальные ключи остаются
 * staffOnly).
 *
 * Тот же приём имперсонации через `sql.begin()` + `set_config(...,
 * true)`, что и в остальных RLS-тестах этого пакета (см. supplier-
 * isolation.test.ts — LOCAL-параметр требует одной транзакции).
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

describeIfConfigured('Document Engine + контур обучения (RLS)', () => {
  it('documents: покупатель пишет по своему заказу, не по чужому; model_snapshots/settings — staff vs публичные реквизиты', async () => {
    const admin = postgres(DATABASE_URL as string, { prepare: false });

    try {
      const buyerCompany = one(
        await admin<{ id: string }[]>`
          insert into companies (type, name) values ('buyer', 'Test Buyer Co') returning id
        `,
      );
      const otherBuyerCompany = one(
        await admin<{ id: string }[]>`
          insert into companies (type, name) values ('buyer', 'Other Buyer Co') returning id
        `,
      );

      const authBuyer = await insertAuthUser(admin, 'rls-test-docs-buyer@example.com');
      await admin`
        insert into public.users (id, company_id, email, full_name, role)
        values (${authBuyer.id}, ${buyerCompany.id}, 'rls-test-docs-buyer@example.com', 'Test Buyer', 'owner')
      `;
      const authOtherBuyer = await insertAuthUser(admin, 'rls-test-docs-other-buyer@example.com');
      await admin`
        insert into public.users (id, company_id, email, full_name, role)
        values (${authOtherBuyer.id}, ${otherBuyerCompany.id}, 'rls-test-docs-other-buyer@example.com', 'Other Buyer', 'owner')
      `;
      const authConcierge = await insertAuthUser(admin, 'rls-test-docs-concierge@example.com');
      await admin`
        insert into public.users (id, company_id, email, full_name, role)
        values (${authConcierge.id}, null, 'rls-test-docs-concierge@example.com', 'Test Concierge', 'concierge')
      `;

      const request = one(
        await admin<{ id: string }[]>`
          insert into requests (buyer_company_id, created_by, title, raw_text)
          values (${buyerCompany.id}, ${authBuyer.id}, 'Test', 'raw')
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
            23000, 'supplier_ex_delivery', 128000, 1, '{}'::jsonb, 'approved'
          )
          returning id
        `,
      );
      const order = one(
        await admin<{ id: string }[]>`
          insert into orders (request_id, approved_plan_id, state, concierge_user_id)
          values (${request.id}, ${plan.id}, 'closed', ${authConcierge.id})
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
        // Покупатель-владелец заказа может вставить документ (акт) по своему заказу.
        const buyerOwnDocument = await asBuyer.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: authBuyer.id, role: 'authenticated' })}, true)`;
          return tx<{ id: string }[]>`
            insert into documents (order_id, stage, type, url, meta)
            values (${order.id}, 'closed', 'act', '/documents/x', '{}'::jsonb)
            returning id
          `;
        });
        expect(buyerOwnDocument).toHaveLength(1);

        // Чужой покупатель не может вставить документ по этому заказу.
        const otherBuyerDocument = await asOtherBuyer
          .begin(async (tx) => {
            await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: authOtherBuyer.id, role: 'authenticated' })}, true)`;
            return tx<{ id: string }[]>`
              insert into documents (order_id, stage, type, url, meta)
              values (${order.id}, 'closed', 'act', '/documents/y', '{}'::jsonb)
              returning id
            `;
          })
          .catch(() => null);
        expect(otherBuyerDocument === null || otherBuyerDocument.length === 0).toBe(true);

        // Концьерж может вставить документ по любому видимому заказу.
        const conciergeDocument = await asConcierge.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: authConcierge.id, role: 'authenticated' })}, true)`;
          return tx<{ id: string }[]>`
            insert into documents (order_id, stage, type, url, meta)
            values (${order.id}, 'prepaid', 'prepay_invoice', '/documents/z', '{}'::jsonb)
            returning id
          `;
        });
        expect(conciergeDocument).toHaveLength(1);

        // Концьерж может писать model_snapshots (замыкание контура обучения).
        const conciergeSnapshot = await asConcierge.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: authConcierge.id, role: 'authenticated' })}, true)`;
          return tx<{ id: string }[]>`
            insert into model_snapshots (model, params, metrics, n_samples)
            values ('matcher', '{}'::jsonb, '{}'::jsonb, 1)
            returning id
          `;
        });
        expect(conciergeSnapshot).toHaveLength(1);

        // Покупатель НЕ может писать model_snapshots — общая модель, не его данные.
        const buyerSnapshot = await asBuyer
          .begin(async (tx) => {
            await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: authBuyer.id, role: 'authenticated' })}, true)`;
            return tx<{ id: string }[]>`
              insert into model_snapshots (model, params, metrics, n_samples)
              values ('matcher', '{}'::jsonb, '{}'::jsonb, 1)
              returning id
            `;
          })
          .catch(() => null);
        expect(buyerSnapshot === null || buyerSnapshot.length === 0).toBe(true);

        // settings: покупатель видит только qajet_requisites, не другие ключи.
        await admin`
          insert into settings (key, value) values ('qajet_requisites', '{"legalName":"Test"}'::jsonb)
          on conflict (key) do nothing
        `;
        await admin`
          insert into settings (key, value) values ('rls_test_secret_key', '42'::jsonb)
          on conflict (key) do nothing
        `;
        const buyerSettings = await asBuyer.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: authBuyer.id, role: 'authenticated' })}, true)`;
          return tx<
            { key: string }[]
          >`select key from settings where key in ('qajet_requisites', 'rls_test_secret_key')`;
        });
        expect(buyerSettings.map((r) => r.key)).toEqual(['qajet_requisites']);
      } finally {
        await asBuyer.end();
        await asOtherBuyer.end();
        await asConcierge.end();
      }

      // Уборка.
      await admin`delete from settings where key = 'rls_test_secret_key'`;
      await admin`delete from model_snapshots where model = 'matcher' and n_samples = 1`;
      await admin`delete from documents where order_id = ${order.id}`;
      await admin`delete from orders where id = ${order.id}`;
      await admin`delete from plans where id = ${plan.id}`;
      await admin`delete from requests where id = ${request.id}`;
      await admin`delete from public.users where id in (${authBuyer.id}, ${authOtherBuyer.id}, ${authConcierge.id})`;
      await admin`delete from auth.users where id in (${authBuyer.id}, ${authOtherBuyer.id}, ${authConcierge.id})`;
      await admin`delete from companies where id in (${buyerCompany.id}, ${otherBuyerCompany.id})`;
    } finally {
      await admin.end();
    }
  });
});
