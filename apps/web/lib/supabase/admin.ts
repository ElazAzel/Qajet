import 'server-only';

import { createClient } from '@supabase/supabase-js';

/**
 * Клиент под service_role: обходит RLS полностью. Только сервер, никогда из
 * Client Component и не со страницы без входа. (`/metrics` по ссылке жюри —
 * отдельный, уже самопроверяющийся клиент в `app/metrics/_jury-access.ts`.)
 *
 * Сама функция никого не авторизует: вызывающий обязан сначала проверить
 * актёра или секрет и только потом обращаться сюда. Места вызова на
 * 2026-09-20 и то, чем каждое закрыто:
 *   - company-actions.ts (создание компании, заметка, повтор приглашения),
 *     requireAdmin();
 *   - team-actions.ts (приглашение в команду), requireOwner();
 *   - attachment-actions.ts (загрузка в Storage), requireCurrentUser();
 *   - api/attachments/[id]/download, строка вложения читается под сессией
 *     пользователя, то есть под RLS, и только затем выдаётся ссылка;
 *   - notifications/dispatcher.ts и learning/dispatcher.ts, вызываются из
 *     /api/jobs/*, закрытых CRON_SECRET (isCronAuthorized);
 *   - api/ready, проверка готовности, данных не отдаёт.
 * Добавляя место вызова, допишите его сюда вместе с его шлюзом.
 */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY не задан — функция недоступна в этом окружении.');
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
