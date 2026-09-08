import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { createPostgresPdBackend } from '../postgres-backend';

/**
 * Интеграционный тест `createPostgresPdBackend()` против РЕАЛЬНОГО
 * Postgres с применёнными RLS-политиками — не фейковый `Sql`, как
 * `postgres-backend.test.ts` (тот проверяет только форму SQL/claims,
 * не то, что RLS реально ограничивает видимость строк). Тот же приём и
 * то же требование к окружению, что и у
 * `packages/db/src/__tests__/supplier-isolation.test.ts`: нужен
 * `DATABASE_URL`, без него `describe.skip`.
 *
 * Открытый пункт из ADR-0005/runbook переезда закрывается именно этим:
 * `PD_BACKEND=postgres` был проверен только юнит-тестами на фейковом
 * `Sql` — здесь тот же путь идёт через настоящую RLS-политику `requests`
 * (agents.md §3.4, ADR-0007), не через подмену.
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

describeIfConfigured('createPostgresPdBackend против реального RLS', () => {
  it('getDeliveryAddress отдаёт адрес своей компании и null — для чужой', async () => {
    const admin = postgres(DATABASE_URL as string, { prepare: false });

    try {
      const companyA = one(
        await admin<{ id: string }[]>`
          insert into companies (type, name) values ('buyer', 'PD Test Buyer A') returning id
        `,
      );
      const companyB = one(
        await admin<{ id: string }[]>`
          insert into companies (type, name) values ('buyer', 'PD Test Buyer B') returning id
        `,
      );

      const authUserA = one(
        await admin<{ id: string }[]>`
          insert into auth.users (
            instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
            confirmation_token, recovery_token, email_change, email_change_token_new,
            email_change_token_current, phone_change, phone_change_token, reauthentication_token
          ) values (
            '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
            'pd-rls-test-buyer-a@example.com', crypt('test-password', gen_salt('bf')), now(),
            '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', ''
          ) returning id
        `,
      );
      const authUserB = one(
        await admin<{ id: string }[]>`
          insert into auth.users (
            instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
            confirmation_token, recovery_token, email_change, email_change_token_new,
            email_change_token_current, phone_change, phone_change_token, reauthentication_token
          ) values (
            '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
            'pd-rls-test-buyer-b@example.com', crypt('test-password', gen_salt('bf')), now(),
            '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', ''
          ) returning id
        `,
      );
      await admin`
        insert into public.users (id, company_id, email, full_name, role)
        values (${authUserA.id}, ${companyA.id}, 'pd-rls-test-buyer-a@example.com', 'Test Buyer A', 'owner')
      `;
      await admin`
        insert into public.users (id, company_id, email, full_name, role)
        values (${authUserB.id}, ${companyB.id}, 'pd-rls-test-buyer-b@example.com', 'Test Buyer B', 'owner')
      `;

      const requestA = one(
        await admin<{ id: string }[]>`
          insert into requests (buyer_company_id, created_by, title, raw_text, delivery_address)
          values (${companyA.id}, ${authUserA.id}, 'PD RLS test', 'raw', 'Алматы, тестовый адрес A')
          returning id
        `,
      );

      const asUserSession = postgres(DATABASE_URL as string, {
        prepare: false,
        connection: { options: '-c role=authenticated' },
      });

      try {
        const backend = createPostgresPdBackend(asUserSession);

        const ownAddress = await backend.getDeliveryAddress(requestA.id, authUserA.id);
        expect(ownAddress).toEqual({
          requestId: requestA.id,
          address: 'Алматы, тестовый адрес A',
        });

        const foreignAddress = await backend.getDeliveryAddress(requestA.id, authUserB.id);
        expect(foreignAddress).toBeNull();
      } finally {
        await asUserSession.end();
      }

      // Уборка.
      await admin`delete from requests where id = ${requestA.id}`;
      await admin`delete from public.users where id in (${authUserA.id}, ${authUserB.id})`;
      await admin`delete from auth.users where id in (${authUserA.id}, ${authUserB.id})`;
      await admin`delete from companies where id in (${companyA.id}, ${companyB.id})`;
    } finally {
      await admin.end();
    }
  });
});
