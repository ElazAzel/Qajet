import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

/**
 * Тест изоляции поставщиков — agents.md §3.4, обязательный тест §15:
 * «Поставщик A физически не может получить данные поставщика B по тому же
 * заказу». Соединение открывается под ролью `authenticated`, а личность
 * пользователя подставляется через `request.jwt.claims`, ровно как это
 * делает PostgREST на каждый запрос — так тест проверяет настоящие RLS
 * policy, а не эмулирует их в приложении.
 *
 * `set_config(..., true)` — LOCAL, живёт только до конца ТЕКУЩЕЙ
 * транзакции: без явного sql.begin() — тот же приём, что в
 * packages/pd/src/postgres-backend.ts — `auth.uid()` снова null уже на
 * следующем отдельном запросе, и импersonation молча не работает. Именно
 * поэтому ассерт ниже проверяет не только отсутствие ЧУЖОЙ строки, но и
 * присутствие СВОЕЙ: изоляция, проверенная только «не вижу чужого», молча
 * проходит и тогда, когда impersonation вообще не сработала и поставщик A
 * не видит ВООБЩЕ НИЧЕГО — находка ревью (P1) при первом переносе этого
 * приёма в новый тестовый файл: без sql.begin() запрос после set_config
 * шёл в новой транзакции и терял claims, но тест этого не ловил.
 *
 * Требует `DATABASE_URL` — прямое подключение к Postgres проекта Supabase
 * (Project Settings → Database → Connection string, роль postgres или
 * пулер в session-режиме). Сервисные ключи и пароль БД никогда не должны
 * попадать в git — значение берётся только из окружения (CI secret или
 * локальный .env, оба в .gitignore).
 */

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfConfigured = DATABASE_URL ? describe : describe.skip;

/** Фикстуры всегда возвращают строку — на пустой результат тест должен упасть, а не пройти молча. */
function one<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) {
    throw new Error('Ожидалась хотя бы одна строка из фикстуры, получено 0.');
  }
  return row;
}

describeIfConfigured('изоляция поставщиков (RLS)', () => {
  it('поставщик A видит свою quote_lines, но не поставщика B по тому же RFQ', async () => {
    const admin = postgres(DATABASE_URL as string, { prepare: false });

    try {
      // Фикстуры: покупатель, два поставщика, заявка, позиция, два RFQ,
      // два КП с одной строкой каждое — минимальный набор для проверки.
      const buyerCompany = one(
        await admin<{ id: string }[]>`
          insert into companies (type, name) values ('buyer', 'Test Buyer Co') returning id
        `,
      );
      const supplierA = one(
        await admin<{ id: string }[]>`
          insert into companies (type, name) values ('supplier', 'Supplier A') returning id
        `,
      );
      const supplierB = one(
        await admin<{ id: string }[]>`
          insert into companies (type, name) values ('supplier', 'Supplier B') returning id
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
            'rls-test-supplier-a@example.com', crypt('test-password', gen_salt('bf')), now(),
            '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', ''
          ) returning id
        `,
      );
      await admin`
        insert into public.users (id, company_id, email, full_name, role)
        values (${authUserA.id}, ${supplierA.id}, 'rls-test-supplier-a@example.com', 'Test A', 'owner')
      `;

      const request = one(
        await admin<{ id: string }[]>`
          insert into requests (buyer_company_id, created_by, title, raw_text)
          values (${buyerCompany.id}, ${authUserA.id}, 'Test', 'raw')
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

      const rfqA = one(
        await admin<{ id: string }[]>`
          insert into rfqs (request_id, supplier_company_id, token)
          values (${request.id}, ${supplierA.id}, ${`tok-a-${crypto.randomUUID()}`})
          returning id
        `,
      );
      const rfqB = one(
        await admin<{ id: string }[]>`
          insert into rfqs (request_id, supplier_company_id, token)
          values (${request.id}, ${supplierB.id}, ${`tok-b-${crypto.randomUUID()}`})
          returning id
        `,
      );

      const quoteA = one(
        await admin<{ id: string }[]>`insert into quotes (rfq_id) values (${rfqA.id}) returning id`,
      );
      const quoteB = one(
        await admin<{ id: string }[]>`insert into quotes (rfq_id) values (${rfqB.id}) returning id`,
      );

      const lineA = one(
        await admin<{ id: string }[]>`
          insert into quote_lines (quote_id, request_item_id, unit_price_kzt, lead_time_days)
          values (${quoteA.id}, ${item.id}, 1000, 5)
          returning id
        `,
      );
      const lineB = one(
        await admin<{ id: string }[]>`
          insert into quote_lines (quote_id, request_item_id, unit_price_kzt, lead_time_days)
          values (${quoteB.id}, ${item.id}, 900, 5)
          returning id
        `,
      );

      // Соединение под ролью authenticated с JWT-claims поставщика A —
      // ровно то, что PostgREST выставляет на каждый запрос. set_config и
      // запрос обязаны жить в одной транзакции (см. комментарий в шапке).
      const asSupplierA = postgres(DATABASE_URL as string, {
        prepare: false,
        connection: { options: '-c role=authenticated' },
      });

      try {
        const visibleIds = await asSupplierA.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: authUserA.id, role: 'authenticated' })}, true)`;
          const rows = await tx<{ id: string }[]>`select id from quote_lines`;
          return rows.map((r) => r.id);
        });

        expect(visibleIds).toContain(lineA.id);
        expect(visibleIds).not.toContain(lineB.id);
      } finally {
        await asSupplierA.end();
      }

      // Уборка.
      await admin`delete from quote_lines where request_item_id = ${item.id}`;
      await admin`delete from quotes where id in (${quoteA.id}, ${quoteB.id})`;
      await admin`delete from rfqs where id in (${rfqA.id}, ${rfqB.id})`;
      await admin`delete from request_items where id = ${item.id}`;
      await admin`delete from requests where id = ${request.id}`;
      await admin`delete from public.users where id = ${authUserA.id}`;
      await admin`delete from auth.users where id = ${authUserA.id}`;
      await admin`delete from companies where id in (${buyerCompany.id}, ${supplierA.id}, ${supplierB.id})`;
    } finally {
      await admin.end();
    }
  });
});
