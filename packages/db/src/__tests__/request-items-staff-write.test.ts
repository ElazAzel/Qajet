import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

/**
 * Изоляция write-политик, добавленных вместе с Classification Engine
 * (agents.md §8A, волна 1 шаг 3): консьерж может править request_items и
 * писать learning_events/extraction_aliases, покупатель — нет. Тот же
 * приём impersonation через request.jwt.claims, что и
 * supplier-isolation.test.ts — единственный способ реально проверить RLS,
 * а не то, что приложение САМО решило не делать запрещённый запрос.
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

describeIfConfigured(
  'write-политики request_items/learning_events/extraction_aliases (RLS)',
  () => {
    it('концьерж может править категорию позиции, покупатель — нет', async () => {
      const admin = postgres(DATABASE_URL as string, { prepare: false });

      try {
        const buyerCompany = one(
          await admin<{ id: string }[]>`
          insert into companies (type, name) values ('buyer', 'Test Buyer Co') returning id
        `,
        );

        const authBuyer = await insertAuthUser(admin, 'rls-test-buyer@example.com');
        await admin`
        insert into public.users (id, company_id, email, full_name, role)
        values (${authBuyer.id}, ${buyerCompany.id}, 'rls-test-buyer@example.com', 'Test Buyer', 'owner')
      `;

        const authConcierge = await insertAuthUser(admin, 'rls-test-concierge@example.com');
        await admin`
        insert into public.users (id, company_id, email, full_name, role)
        values (${authConcierge.id}, null, 'rls-test-concierge@example.com', 'Test Concierge', 'concierge')
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

        const asBuyer = postgres(DATABASE_URL as string, {
          prepare: false,
          connection: { options: '-c role=authenticated' },
        });
        const asConcierge = postgres(DATABASE_URL as string, {
          prepare: false,
          connection: { options: '-c role=authenticated' },
        });

        try {
          await asBuyer`select set_config('request.jwt.claims', ${JSON.stringify({ sub: authBuyer.id, role: 'authenticated' })}, true)`;
          const buyerUpdate =
            await asBuyer`update request_items set category = 'printing' where id = ${item.id} returning id`;
          expect(buyerUpdate).toHaveLength(0);

          await asConcierge`select set_config('request.jwt.claims', ${JSON.stringify({ sub: authConcierge.id, role: 'authenticated' })}, true)`;
          const conciergeUpdate =
            await asConcierge`update request_items set category = 'printing' where id = ${item.id} returning id, category`;
          expect(conciergeUpdate).toHaveLength(1);
          expect(conciergeUpdate[0]?.category).toBe('printing');

          const learningInsert = await asConcierge`
          insert into learning_events (type, payload)
          values ('extraction_fix', ${JSON.stringify({ requestItemId: item.id })})
          returning id
        `;
          expect(learningInsert).toHaveLength(1);

          const aliasInsert = await asConcierge`
          insert into extraction_aliases (alias, canonical, kind, hits, confirmed_by)
          values ('тестовый алиас', 'printing', 'category', 1, ${authConcierge.id})
          returning id
        `;
          expect(aliasInsert).toHaveLength(1);

          const buyerAliasInsert = await asBuyer`
          insert into extraction_aliases (alias, canonical, kind, hits)
          values ('чужой алиас', 'merch', 'category', 1)
          returning id
        `.catch(() => []);
          expect(buyerAliasInsert).toHaveLength(0);

          await admin`delete from extraction_aliases where id = ${aliasInsert[0]?.id}`;
          await admin`delete from learning_events where id = ${learningInsert[0]?.id}`;
        } finally {
          await asBuyer.end();
          await asConcierge.end();
        }

        await admin`delete from request_items where id = ${item.id}`;
        await admin`delete from requests where id = ${request.id}`;
        await admin`delete from public.users where id in (${authBuyer.id}, ${authConcierge.id})`;
        await admin`delete from auth.users where id in (${authBuyer.id}, ${authConcierge.id})`;
        await admin`delete from companies where id = ${buyerCompany.id}`;
      } finally {
        await admin.end();
      }
    });
  },
);
