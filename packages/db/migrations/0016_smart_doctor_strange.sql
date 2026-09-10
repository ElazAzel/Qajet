CREATE POLICY "permissions_insert_owner" ON "permissions" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_role()) = 'owner' and "permissions"."user_id" in (select id from "users" where company_id = (select public.current_company_id())));--> statement-breakpoint
CREATE POLICY "permissions_update_owner" ON "permissions" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_role()) = 'owner' and "permissions"."user_id" in (select id from "users" where company_id = (select public.current_company_id())));--> statement-breakpoint
-- Лимит согласования и отзыв доступа (agents.md §10 «Команда и доступы»).
-- RPC, а не UPDATE-политика на users: RLS не умеет ограничивать КОЛОНКИ, и
-- политика «владелец может править строки своей компании» позволила бы ему
-- же переписать role или email коллеги. Функция меняет ровно два поля.
--
-- SECURITY DEFINER, а не INVOKER (как у split_request_item): у той функции
-- вызывающий сам имеет право писать в таблицу, а здесь политики UPDATE на
-- users нет вовсе — под INVOKER этот UPDATE молча затрагивал ноль строк,
-- экран показывал успех, а лимит не менялся (найдено живой проверкой).
-- DEFINER безопасен именно потому, что функция сама проверяет вызывающего
-- и пишет ровно две колонки — то же обоснование, что у current_role().
CREATE OR REPLACE FUNCTION public.set_team_member_access(
  p_user_id uuid,
  p_approval_limit_kzt bigint,
  p_is_active boolean
)
RETURNS public.users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.users;
  v_caller public.users;
BEGIN
  SELECT * INTO v_caller FROM public.users WHERE id = (select auth.uid());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_team_member_access: вызывающий не найден';
  END IF;
  IF v_caller.role <> 'owner' THEN
    RAISE EXCEPTION 'set_team_member_access: доступно только владельцу компании';
  END IF;

  SELECT * INTO v_row FROM public.users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_team_member_access: сотрудник % не найден', p_user_id;
  END IF;
  IF v_row.company_id IS DISTINCT FROM v_caller.company_id THEN
    RAISE EXCEPTION 'set_team_member_access: сотрудник не из вашей компании';
  END IF;
  -- Владелец не может отозвать доступ сам у себя: компания осталась бы без
  -- никого, кто способен вернуть доступ обратно.
  IF p_user_id = v_caller.id AND p_is_active = false THEN
    RAISE EXCEPTION 'set_team_member_access: нельзя отозвать доступ у самого себя';
  END IF;

  UPDATE public.users
  SET approval_limit_kzt = p_approval_limit_kzt,
      is_active = p_is_active,
      updated_at = now()
  WHERE id = p_user_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
--> statement-breakpoint
-- Supabase выдаёт EXECUTE на новые функции роли anon по умолчанию, и линтер
-- базы это справедливо помечает. Анонимный вызов и так падал бы на первой
-- же строке (auth.uid() пуст → вызывающий не найден), но право, которое
-- никому не нужно, лучше отозвать, а не полагаться на то, что внутренняя
-- проверка не даст им воспользоваться.
REVOKE EXECUTE ON FUNCTION public.set_team_member_access(uuid, bigint, boolean) FROM anon;
