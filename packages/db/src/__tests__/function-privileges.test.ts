import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

/**
 * Права на SECURITY DEFINER функции — agents.md, раздел Privileged access:
 * «restrictive grants» для каждой такой функции.
 *
 * Почему тест общий, а не про одну функцию. `REVOKE ... FROM anon` уже дважды
 * оказывался бесполезным (см. 0016 и 0018): Supabase выдаёт EXECUTE роли anon
 * на каждую новую функцию через default privileges, и любое пересоздание
 * возвращало грант. Поэтому проверяется итоговое состояние всех функций
 * схемы public, а не то, что написано в конкретной миграции.
 *
 * Триггерные функции вызываются только самим триггером — прямой вызов через
 * /rest/v1/rpc им не нужен ни для anon, ни для authenticated.
 */

const databaseUrl = process.env.DATABASE_URL;
const describeIfConfigured = databaseUrl ? describe : describe.skip;

/** Единственные функции, которые анонимный посетитель вызывает по подписанной ссылке RFQ. */
const ANON_ALLOWLIST = new Set([
  'get_rfq_quick_response',
  'quick_respond_rfq_public',
  'decline_rfq_public',
  'submit_rfq_public',
]);

interface FunctionRow {
  name: string;
  is_trigger: boolean;
  anon_can_execute: boolean;
  authenticated_can_execute: boolean;
}

describeIfConfigured('права на SECURITY DEFINER функции схемы public', () => {
  async function load(): Promise<FunctionRow[]> {
    const sql = postgres(databaseUrl as string, { max: 1, prepare: false });
    try {
      return await sql<FunctionRow[]>`
        select p.proname as name,
               p.prorettype = 'trigger'::regtype as is_trigger,
               has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
               has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
        from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prokind = 'f'
        order by p.proname`;
    } finally {
      await sql.end();
    }
  }

  it('анонимная роль не исполняет ничего, кроме четырёх публичных RFQ-функций', async () => {
    const rows = await load();
    expect(rows.length).toBeGreaterThan(20);
    const leaked = rows
      .filter((r) => r.anon_can_execute && !ANON_ALLOWLIST.has(r.name))
      .map((r) => r.name);
    expect(leaked).toEqual([]);
  });

  it('публичные RFQ-функции остаются доступны анонимной роли', async () => {
    const rows = await load();
    for (const name of ANON_ALLOWLIST) {
      const row = rows.find((r) => r.name === name);
      expect(row, `функция ${name} не найдена`).toBeDefined();
      expect(row?.anon_can_execute, `${name} должна быть доступна anon`).toBe(true);
    }
  });

  it('триггерные функции недоступны для прямого вызова через API', async () => {
    const rows = await load();
    const exposed = rows
      .filter((r) => r.is_trigger && r.authenticated_can_execute)
      .map((r) => r.name);
    expect(exposed).toEqual([]);
  });

  it('рабочие RPC остаются доступны вошедшему пользователю', async () => {
    const rows = await load();
    for (const name of [
      'approve_plan',
      'select_order_plan',
      'confirm_supplier_delivery',
      'current_company_id',
    ]) {
      const row = rows.find((r) => r.name === name);
      expect(row?.authenticated_can_execute, `${name} должна быть доступна authenticated`).toBe(
        true,
      );
    }
  });
});
