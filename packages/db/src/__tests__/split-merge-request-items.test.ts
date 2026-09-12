import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

/**
 * Dependency Engine (agents.md §8A, волна 1 шаг 6): split_request_item/
 * merge_request_items — SECURITY INVOKER RPC поверх request_items. Явная
 * проверка роли — первая строка каждой функции (см. комментарий в
 * миграции 0011_aromatic_deathstrike.sql) — без неё buyer, вызвав RPC
 * напрямую мимо приложения, получил бы наполовину сработавший split:
 * insert новых строк в СВОЮ заявку у него и так разрешён
 * (request_items_insert_buyer_own), а delete исходной — нет, что
 * оставляло бы дубликаты вместо чистого отказа. Тест проверяет именно
 * это: buyer не получает ни новых строк, ни удаления исходной.
 *
 * `set_config(..., true)` — LOCAL, требует sql.begin() в одной
 * транзакции с последующими запросами — тот же приём и та же на практике
 * найденная ошибка (P1 в supplier-isolation.test.ts), что и в остальных
 * RLS-тестах этого пакета.
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

describeIfConfigured('split_request_item/merge_request_items (RLS)', () => {
  it('консьерж может разделить и объединить позицию, покупатель — нет', async () => {
    const admin = postgres(DATABASE_URL as string, { prepare: false });

    try {
      const buyerCompany = one(
        await admin<{ id: string }[]>`
          insert into companies (type, name) values ('buyer', 'Test Buyer Co') returning id
        `,
      );
      const authBuyer = await insertAuthUser(admin, 'rls-test-split-buyer@example.com');
      await admin`
        insert into public.users (id, company_id, email, full_name, role)
        values (${authBuyer.id}, ${buyerCompany.id}, 'rls-test-split-buyer@example.com', 'Test Buyer', 'owner')
      `;
      const authConcierge = await insertAuthUser(admin, 'rls-test-split-concierge@example.com');
      await admin`
        insert into public.users (id, company_id, email, full_name, role)
        values (${authConcierge.id}, null, 'rls-test-split-concierge@example.com', 'Test Concierge', 'concierge')
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
          values (${request.id}, 'Комплект: футболки и кепки', 'merch', 150, 'шт')
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

      // Не JSON.stringify: postgres.js сам сериализует параметр под
      // ::jsonb (types.js — serialize: x => JSON.stringify(x)) — заранее
      // застрингованное значение задваивает кодирование и превращает
      // jsonb-массив в jsonb-строку, split_request_item тогда падает на
      // собственной проверке jsonb_typeof(p_parts) <> 'array'. Поймано
      // на CI (job «Тест изоляции поставщиков»), локально не запускается
      // без DATABASE_URL.
      const splitParts = [
        { name: 'Футболки с логотипом', qty: 100 },
        { name: 'Кепки с логотипом', qty: 50 },
      ];

      let splitIds: string[] = [];
      try {
        // Покупатель не может вызвать RPC на своей же позиции — ни новых
        // строк, ни удаления исходной (см. комментарий в шапке файла).
        const buyerSplit = await asBuyer
          .begin(async (tx) => {
            await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: authBuyer.id, role: 'authenticated' })}, true)`;
            return tx<
              { id: string }[]
            >`select * from split_request_item(${item.id}, ${tx.json(splitParts)})`;
          })
          .catch(() => null);
        expect(buyerSplit).toBeNull();

        const itemAfterBuyerAttempt = one(
          await admin<{ id: string; category: string }[]>`
            select id, category from request_items where id = ${item.id}
          `,
        );
        expect(itemAfterBuyerAttempt.id).toBe(item.id);
        const itemsForRequest = await admin<{ id: string }[]>`
          select id from request_items where request_id = ${request.id}
        `;
        expect(itemsForRequest).toHaveLength(1);

        const mismatchedParts = [
          { name: 'Футболки с логотипом', qty: 99 },
          { name: 'Кепки с логотипом', qty: 50 },
        ];
        const rejectedMismatchedSplit = await asConcierge
          .begin(async (tx) => {
            await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: authConcierge.id, role: 'authenticated' })}, true)`;
            return tx.savepoint(
              (sp) => sp`select * from split_request_item(${item.id}, ${sp.json(mismatchedParts)})`,
            );
          })
          .catch(() => null);
        expect(rejectedMismatchedSplit).toBeNull();
        expect(
          await admin<{ id: string }[]>`
            select id from request_items where request_id = ${request.id}
          `,
        ).toHaveLength(1);

        // Консьерж — split проходит: исходная позиция удаляется, вместо
        // неё 2 новые с needs_clarification=true (Completeness Engine,
        // шаг 1 волны — новые строки требуют подтверждения).
        const conciergeSplit = await asConcierge.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: authConcierge.id, role: 'authenticated' })}, true)`;
          return tx<{ id: string; name: string; qty: number; needs_clarification: boolean }[]>`
            select * from split_request_item(${item.id}, ${tx.json(splitParts)})
          `;
        });
        expect(conciergeSplit).toHaveLength(2);
        expect(conciergeSplit.every((row) => row.needs_clarification)).toBe(true);
        splitIds = conciergeSplit.map((row) => row.id);

        const originalAfterSplit = await admin<{ id: string }[]>`
          select id from request_items where id = ${item.id}
        `;
        expect(originalAfterSplit).toHaveLength(0);

        // Покупатель не может объединить чужим (для него) действием —
        // merge тоже требует staff-роль первой же строкой функции.
        const buyerMerge = await asBuyer
          .begin(async (tx) => {
            await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: authBuyer.id, role: 'authenticated' })}, true)`;
            return tx<{ id: string }[]>`select * from merge_request_items(${splitIds})`;
          })
          .catch(() => null);
        expect(buyerMerge).toBeNull();

        const itemsBeforeMerge = await admin<{ id: string }[]>`
          select id from request_items where request_id = ${request.id}
        `;
        expect(itemsBeforeMerge).toHaveLength(2);

        // Консьерж объединяет обратно — 1 новая строка с суммой qty,
        // обе части удалены.
        const conciergeMerge = await asConcierge.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: authConcierge.id, role: 'authenticated' })}, true)`;
          return tx<{ id: string; qty: number; needs_clarification: boolean }[]>`
            select * from merge_request_items(${splitIds}) as merged
          `;
        });
        expect(conciergeMerge).toHaveLength(1);
        expect(conciergeMerge[0]?.qty).toBe(150);
        expect(conciergeMerge[0]?.needs_clarification).toBe(true);
        splitIds = conciergeMerge[0] ? [conciergeMerge[0].id] : [];

        const remainingItems = await admin<{ id: string }[]>`
          select id from request_items where request_id = ${request.id}
        `;
        expect(remainingItems).toHaveLength(1);
      } finally {
        await asBuyer.end();
        await asConcierge.end();
      }

      // Уборка.
      await admin`delete from request_items where request_id = ${request.id}`;
      await admin`delete from requests where id = ${request.id}`;
      await admin`delete from public.users where id in (${authBuyer.id}, ${authConcierge.id})`;
      await admin`delete from auth.users where id in (${authBuyer.id}, ${authConcierge.id})`;
      await admin`delete from companies where id = ${buyerCompany.id}`;
    } finally {
      await admin.end();
    }
  });
});
