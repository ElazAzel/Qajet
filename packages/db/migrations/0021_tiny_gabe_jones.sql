-- agents.md §10 «Консьерж → внутренние заметки»: «видны только сотрудникам
-- QAJET» — kind='internal' уже физически закрыт от покупателя и
-- поставщика (threads_select_staff/threads_select_buyer/
-- threads_select_own_supplier, миграция 0000). Но INSERT на threads не
-- было ни одной политики для authenticated (только service_all) —
-- создать внутренний тред можно было только в обход PostgREST. Экрана с
-- заметками тоже не существовало: маршрута для них не было.
--
-- Область — строго 'internal': у threads kind='buyer'/'supplier' своя
-- семантика (заводится вместе с RFQ/заявкой), эта политика её не трогает.
CREATE POLICY "threads_insert_staff_internal" ON "threads" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("threads"."kind" = 'internal' and (select public.current_role()) in ('concierge', 'admin'));
--> statement-breakpoint
-- Четвёртый раз подряд то же самое (0018, 0020) — anon снова получает
-- EXECUTE на set_team_member_access после apply_migration к
-- НЕСВЯЗАННОМУ объекту (в этот раз это вообще не функция, а policy).
-- Первопричина в конфигурации проекта Supabase, не в этом коде; пока она
-- не найдена, каждая миграция обязана заканчиваться этим REVOKE.
REVOKE EXECUTE ON FUNCTION public.set_team_member_access(uuid, bigint, boolean) FROM anon;
