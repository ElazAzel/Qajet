import { describe, expect, it } from 'vitest';
import { createPostgresPdBackend } from '../postgres-backend';

/**
 * Юнит-тест без реального Postgres: подменяет `Sql` фейком, который
 * записывает каждый вызов (текст шаблона + подставленные значения) и
 * отдаёт заранее заданные строки — этого достаточно, чтобы проверить
 * САМ КОНТРАКТ (какая claim уходит в set_config, каким id идёт запрос,
 * как маппится snake_case → camelCase), не поднимая живую БД. Реальная
 * проверка RLS на этом бэкенде требует DATABASE_URL к базе с применёнными
 * миграциями packages/db/policies — тот же открытый пункт, что и у
 * packages/db/src/__tests__/supplier-isolation.test.ts (см. README
 * «Известные ограничения»).
 */

interface Call {
  strings: readonly string[];
  values: unknown[];
}

function createFakeSql(rowsByCallIndex: unknown[][]) {
  const calls: Call[] = [];
  let queryIndex = 0;

  function tag(strings: TemplateStringsArray, ...values: unknown[]) {
    calls.push({ strings: Array.from(strings), values });
    // Первый вызов внутри begin() — всегда set_config, не возвращает строк,
    // которые нас интересуют; строки данных отдаём по следующим вызовам.
    const isSetConfig = strings.some((s) => s.includes('set_config'));
    if (isSetConfig) return Promise.resolve([]);
    const rows = rowsByCallIndex[queryIndex] ?? [];
    queryIndex += 1;
    return Promise.resolve(rows);
  }

  async function begin<T>(fn: (tx: typeof tag) => Promise<T>): Promise<T> {
    return fn(tag);
  }

  return { sql: Object.assign(tag, { begin }), calls };
}

describe('createPostgresPdBackend', () => {
  it('возвращает контакт пользователя и ставит его sub в request.jwt.claims', async () => {
    const { sql, calls } = createFakeSql([
      [{ id: 'u1', full_name: 'Данияр Уков', email: 'daniyar@example.kz' }],
    ]);
    const backend = createPostgresPdBackend(sql as never);

    const contact = await backend.getUserContact('u1');

    expect(contact).toEqual({ id: 'u1', fullName: 'Данияр Уков', email: 'daniyar@example.kz' });
    const claimCall = calls.find((c) => c.strings.some((s) => s.includes('set_config')));
    expect(claimCall?.values[0]).toBe(JSON.stringify({ sub: 'u1', role: 'authenticated' }));
  });

  it('возвращает null, если пользователь не найден', async () => {
    const { sql } = createFakeSql([[]]);
    const backend = createPostgresPdBackend(sql as never);

    expect(await backend.getUserContact('missing')).toBeNull();
  });

  it('ставит claim от имени actingUserId, а не requestId, для адреса доставки', async () => {
    const { sql, calls } = createFakeSql([[{ id: 'r1', delivery_address: 'Алматы, ул. Абая 10' }]]);
    const backend = createPostgresPdBackend(sql as never);

    const address = await backend.getDeliveryAddress('r1', 'buyer-42');

    expect(address).toEqual({ requestId: 'r1', address: 'Алматы, ул. Абая 10' });
    const claimCall = calls.find((c) => c.strings.some((s) => s.includes('set_config')));
    expect(claimCall?.values[0]).toBe(JSON.stringify({ sub: 'buyer-42', role: 'authenticated' }));
  });

  it('возвращает null, если адрес доставки пустой', async () => {
    const { sql } = createFakeSql([[{ id: 'r1', delivery_address: null }]]);
    const backend = createPostgresPdBackend(sql as never);

    expect(await backend.getDeliveryAddress('r1', 'buyer-42')).toBeNull();
  });
});
