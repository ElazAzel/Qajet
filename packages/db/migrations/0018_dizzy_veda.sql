-- Разбор code review на PR #13 по барьеру неизменяемости утверждённого
-- плана (0016_smart_doctor_strange.sql). Три реальных дефекта в том, что
-- было написано, — два из них ломают не только защиту, но и обслуживание:
--
-- 1. Триггер на plan_lines висел только на UPDATE/DELETE, а INSERT-политика
--    plan_lines_insert_staff осталась открытой: staff-сессия могла ДОБАВИТЬ
--    строку в уже утверждённый план и тем изменить его состав, не тронув ни
--    одной существующей строки.
-- 2. BEFORE DELETE возвращал NEW, а на DELETE NEW всегда NULL — а возврат
--    NULL из BEFORE-триггера отменяет операцию. То есть удаление ЛЮБОЙ
--    строки плана (не только утверждённого) молча не выполнялось, без
--    ошибки. `pnpm db:reset` и каскад от `delete from plans` при этом
--    падали или тихо не отрабатывали.
-- 3. Из approved можно было выйти в draft/proposed, ничего не меняя, и
--    вторым запросом переписать суммы: OLD.status уже не 'approved'.
--    Разрешён должен быть ровно один выход — 'superseded'.
--
-- Барьер нацелен на сессию через PostgREST (роль authenticated): только у
-- неё есть политики записи на plans/plan_lines. service_role и postgres и
-- так проходят мимо всей RLS — останавливать их здесь значит ломать сид
-- (он вставляет план со status='approved', а строки к нему — следующим
-- запросом) и `pnpm db:reset`, не закрывая при этом ни одного пути.
-- Повторный отзыв, а не дубль: тот же REVOKE есть в 0016, но на боевой базе
-- право у anon снова оказалось выдано (Supabase выдаёт EXECUTE новым
-- функциям роли anon по умолчанию, и любое пересоздание функции возвращает
-- грант). Проверено `has_function_privilege('anon', …, 'EXECUTE')` = true до
-- этой миграции. Отзыв обязан идти последним после каждого пересоздания.
REVOKE EXECUTE ON FUNCTION public.set_team_member_access(uuid, bigint, boolean) FROM anon;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.enforce_approved_plan_lines_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_plan_id uuid;
  v_status text;
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  v_plan_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.plan_id ELSE OLD.plan_id END;
  SELECT status INTO v_status FROM public.plans WHERE id = v_plan_id;
  IF v_status = 'approved' THEN
    RAISE EXCEPTION 'Строки утверждённого плана изменять нельзя — заведите новую версию плана (agents.md §15)';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS enforce_approved_plan_lines_immutable ON public.plan_lines;--> statement-breakpoint
CREATE TRIGGER enforce_approved_plan_lines_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON public.plan_lines
  FOR EACH ROW EXECUTE FUNCTION public.enforce_approved_plan_lines_immutable();--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.enforce_approved_plan_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.status <> 'approved' THEN
    RETURN NEW;
  END IF;

  -- Единственный разрешённый выход из approved. Без этой проверки защита
  -- ниже снимается в два запроса: сначала approved → draft, потом правка
  -- сумм, которую OLD.status = 'draft' уже пропускает.
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'superseded' THEN
    RAISE EXCEPTION 'Утверждённый план можно только пометить superseded — заведите новую версию плана (agents.md §15)';
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
$$;
