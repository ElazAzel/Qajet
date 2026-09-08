-- Найдено при разборе требования «консьержи будут добавляться и удаляться»
-- (agents.md §10, история видимости staff): current_role()/current_company_id()
-- читали users.role/company_id без учёта is_active. FK order_stage_events.
-- actor_user_id -> users(restrict) не даёт физически удалить строку
-- сотрудника, который уже что-то делал — единственный реальный способ
-- «убрать» его — is_active = false (agents.md §10 «Админ»: «отзыв доступа»).
-- Но обе функции его не проверяли: деактивированный концьерж навсегда
-- оставался бы staffOnly для RLS. Добавление `and is_active` — то же самое
-- узкое место для company_id (деактивированный сотрудник компании тоже не
-- должен сохранять доступ к её данным).
CREATE OR REPLACE FUNCTION public.current_company_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT company_id FROM public.users WHERE id = auth.uid() AND is_active
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.current_role()
RETURNS user_role
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM public.users WHERE id = auth.uid() AND is_active
$$;
