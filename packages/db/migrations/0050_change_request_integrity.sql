-- Запрос изменения плана нельзя переписать задним числом (G7).
-- Воспроизведено packages/db/src/__tests__/change-request-integrity.test.ts.
--
-- change_requests_update_staff давала консьержу право менять любые колонки, а
-- diff->>'reason' служит запасным источником причины перехода заказа, так что
-- подмена текста меняла запись аудита. Допустимо одно: перевести pending в
-- accepted или declined; при принятии resolve_plan_change добавляет в diff ключи
-- appliedPlanId и appliedAt. Всё остальное неизменяемо для сессий PostgREST.
CREATE OR REPLACE FUNCTION public.guard_change_request_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_setting('role', true) NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF NEW.order_id IS DISTINCT FROM OLD.order_id
    OR NEW.proposed_plan_id IS DISTINCT FROM OLD.proposed_plan_id
    OR NEW.initiator_user_id IS DISTINCT FROM OLD.initiator_user_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Запрос изменения нельзя переписать';
  END IF;
  IF (NEW.diff - 'appliedPlanId' - 'appliedAt') IS DISTINCT FROM (OLD.diff - 'appliedPlanId' - 'appliedAt') THEN
    RAISE EXCEPTION 'Содержание запроса изменения нельзя менять';
  END IF;
  IF OLD.status <> 'pending' AND (
    NEW.status IS DISTINCT FROM OLD.status OR NEW.diff IS DISTINCT FROM OLD.diff
  ) THEN
    RAISE EXCEPTION 'Обработанный запрос изменения нельзя менять';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_change_request_update() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
DROP TRIGGER IF EXISTS change_requests_guard_update ON public.change_requests;--> statement-breakpoint
CREATE TRIGGER change_requests_guard_update
BEFORE UPDATE ON public.change_requests
FOR EACH ROW EXECUTE FUNCTION public.guard_change_request_update();
