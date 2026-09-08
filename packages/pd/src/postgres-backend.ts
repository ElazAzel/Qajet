import type { Sql, TransactionSql } from 'postgres';
import type { PdBackend } from './backend';

/**
 * Бэкенд для переезда на казахстанский ДЦ (agents.md §11.1, ADR-0005) —
 * отдельный Postgres (например, реплика/перенесённые таблицы users/requests
 * физически в РК), подключение напрямую по TCP теми же `postgres`
 * (porsager), что уже использует packages/db для миграций/сида и теста
 * изоляции поставщиков — не через PostgREST/Supabase Auth, как MVP-бэкенд
 * в backend.ts.
 *
 * Прямое TCP-подключение не значит доступ от суперпользователя: RLS-политики
 * (packages/db/policies) применены и к этой базе — раз мы обходим PostgREST,
 * обязаны сами воспроизвести то, что он делает на каждый HTTP-запрос.
 * Роль `authenticated` — на уровне самого подключения (общая для всех
 * залогиненных пользователей, RLS дальше сама сверяет `auth.uid()` с
 * `request.jwt.claims`), а вот `sub` конкретного пользователя — на
 * каждый вызов, внутри транзакции (`set_config(..., true)` живёт до
 * COMMIT/ROLLBACK, не дольше). Тот же приём, которым в этом проекте
 * вручную проверялась RLS-изоляция поставщиков
 * (packages/db/src/__tests__/supplier-isolation.test.ts, ADR-0007) —
 * здесь он не разовая проверка, а обязательная часть каждого запроса.
 */
export function createPostgresPdBackend(sql: Sql): PdBackend {
  async function withUserSession<T>(
    userId: string,
    run: (tx: TransactionSql) => Promise<T>,
  ): Promise<T> {
    // postgres.js типизирует `begin<T>` через `UnwrapPromiseArray<T>` (заточено
    // под запросы-массивы) — для простого объекта-результата это не сходится
    // с T один-в-один на уровне типов, при этом рантайм-значение то же самое.
    const result = await sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`;
      return run(tx);
    });
    return result as T;
  }

  return {
    async getUserContact(userId) {
      return withUserSession(userId, async (tx) => {
        const rows = await tx<{ id: string; full_name: string; email: string }[]>`
          select id, full_name, email from users where id = ${userId}
        `;
        const row = rows[0];
        if (!row) return null;
        return { id: row.id, fullName: row.full_name, email: row.email };
      });
    },

    async getDeliveryAddress(requestId, actingUserId) {
      return withUserSession(actingUserId, async (tx) => {
        const rows = await tx<{ id: string; delivery_address: string | null }[]>`
          select id, delivery_address from requests where id = ${requestId}
        `;
        const row = rows[0];
        if (!row?.delivery_address) return null;
        return { requestId: row.id, address: row.delivery_address };
      });
    },
  };
}
