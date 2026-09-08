import type { SupabaseClient } from '@supabase/supabase-js';
import postgres, { type Sql } from 'postgres';
import { createSupabasePdBackend, type PdBackend } from './backend';
import { createPostgresPdBackend } from './postgres-backend';

export type { DeliveryAddress, PdBackend, UserContact } from './backend';
export { createSupabasePdBackend } from './backend';
export type { MaskedPayload, MaskResult, PiiEntity, PiiEntityType, UnmaskMap } from './mask';
export { maskPII, unmaskPII } from './mask';
export { createPostgresPdBackend } from './postgres-backend';

let postgresClient: Sql | undefined;

/** Один клиент (со своим внутренним пулом) на процесс — не пересоздавать
 *  соединения на каждый вызов. Роль `authenticated` — на уровне самого
 *  подключения, `sub` пользователя — за вызов, см. postgres-backend.ts. */
function getPostgresClient(): Sql {
  if (!postgresClient) {
    const connectionString = process.env.PD_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        'PD_BACKEND=postgres требует PD_DATABASE_URL (или DATABASE_URL) — строку подключения к казахстанскому ДЦ.',
      );
    }
    postgresClient = postgres(connectionString, {
      prepare: false,
      connection: { options: '-c role=authenticated' },
    });
  }
  return postgresClient;
}

/**
 * Единственная точка входа для остального кода: `createPdClient(supabase)`
 * вместо прямого `supabase.from('users')`/`.from('requests')` в apps/web.
 *
 * Переезд на казахстанский ДЦ (agents.md §11.1) — это `PD_BACKEND=postgres`
 * + `PD_DATABASE_URL` в окружении, без изменений в apps/web: вызывающий код
 * знает только интерфейс `PdBackend`, а не то, где физически лежат данные.
 * По умолчанию (`PD_BACKEND` не задан) — MVP-бэкенд через ту же
 * Supabase-сессию, что и весь остальной код.
 */
export function createPdClient(supabase: SupabaseClient): PdBackend {
  if (process.env.PD_BACKEND === 'postgres') {
    return createPostgresPdBackend(getPostgresClient());
  }
  return createSupabasePdBackend(supabase);
}
