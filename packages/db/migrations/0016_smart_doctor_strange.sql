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
--> statement-breakpoint
-- §15: «изменение утверждённого плана создаёт новую версию, а не правит
-- заказ». До этого триггера правило жило только в приложении
-- (PLAN_EDITABLE_STATES, apps/web/app/lib/order-state.ts), а
-- plans_update_staff/plan_lines_update_staff позволяли staff-сессии
-- переписать суммы уже утверждённого плана напрямую через PostgREST — то
-- есть поменять цену задним числом после согласия покупателя. Второй,
-- независимый барьер в Postgres — тот же приём, что enforce_order_transition
-- (0001_pale_lockjaw.sql). Смена статуса approved → superseded остаётся
-- разрешённой: именно так и выглядит «завести новую версию».
CREATE OR REPLACE FUNCTION public.enforce_approved_plan_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.status <> 'approved' THEN
    RETURN NEW;
  END IF;

  IF NEW.total_supplier_kzt IS DISTINCT FROM OLD.total_supplier_kzt
     OR NEW.delivery_kzt IS DISTINCT FROM OLD.delivery_kzt
     OR NEW.commission_kzt IS DISTINCT FROM OLD.commission_kzt
     OR NEW.commission_base IS DISTINCT FROM OLD.commission_base
     OR NEW.tax_effect_kzt IS DISTINCT FROM OLD.tax_effect_kzt
     OR NEW.total_kzt IS DISTINCT FROM OLD.total_kzt
     OR NEW.eta_date IS DISTINCT FROM OLD.eta_date
     OR NEW.slack_days IS DISTINCT FROM OLD.slack_days
     OR NEW.supplier_count IS DISTINCT FROM OLD.supplier_count
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.request_id IS DISTINCT FROM OLD.request_id THEN
    RAISE EXCEPTION 'Утверждённый план изменять нельзя — заведите новую версию плана (agents.md §15)';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS enforce_approved_plan_immutable ON public.plans;--> statement-breakpoint
CREATE TRIGGER enforce_approved_plan_immutable
  BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.enforce_approved_plan_immutable();--> statement-breakpoint
-- Состав утверждённого плана — та же гарантия: переписать строку плана
-- значит изменить и цену, и что именно закупается.
CREATE OR REPLACE FUNCTION public.enforce_approved_plan_lines_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.plans WHERE id = OLD.plan_id;
  IF v_status = 'approved' THEN
    RAISE EXCEPTION 'Строки утверждённого плана изменять нельзя — заведите новую версию плана (agents.md §15)';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS enforce_approved_plan_lines_immutable ON public.plan_lines;--> statement-breakpoint
CREATE TRIGGER enforce_approved_plan_lines_immutable
  BEFORE UPDATE OR DELETE ON public.plan_lines
  FOR EACH ROW EXECUTE FUNCTION public.enforce_approved_plan_lines_immutable();
