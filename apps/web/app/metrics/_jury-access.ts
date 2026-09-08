import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { verifySignedLink } from '../lib/signed-link';

/**
 * Доступ к `/metrics` без входа (agents.md §9: «временная ссылка для
 * жюри»). Скоуп подписанного токена — только этот экран, ни на что
 * другое токен не годится (см. signed-link.ts).
 */
export const JURY_SCOPE = 'metrics_jury';
/** 24 часа — разумный срок для одной демонстрации/защиты, не бессрочная ссылка. */
export const JURY_LINK_TTL_SECONDS = 60 * 60 * 24;

export function isValidJuryToken(token: string | undefined): boolean {
  if (!token) return false;
  return verifySignedLink(token, JURY_SCOPE) !== null;
}

/**
 * Клиент под `service_role` — единственное исключение в apps/web из
 * правила «никогда под service_role» (см. комментарий в
 * `apps/web/lib/supabase/server.ts`). Обосновано узко: RLS не может
 * выразить «авторизован по владению непредъявляемым секретом из URL» —
 * `using`-клаузы политик видят колонки строки и claims сессии, не
 * параметры запроса. Анонимная политика вида `to: anon, using: true` на
 * таблицах, которые читает `loadMetrics()`, открыла бы эти данные ЛЮБОМУ
 * держателю публичного anon-ключа, а не только тому, у кого есть валидный
 * подписанный токен. Авторизация здесь — `isValidJuryToken()` ДО вызова
 * этой функции, а не RLS; вызывать без предварительной проверки токена
 * нельзя.
 */
export function createJuryMetricsClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY не задан в этом окружении — ссылка для жюри недоступна.',
    );
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
