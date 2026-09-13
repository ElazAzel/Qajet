ALTER TABLE "supplier_profiles" ADD COLUMN "service_cities" text[] DEFAULT '{}'::text[] NOT NULL;
--> statement-breakpoint

-- Exceptional transitions need a human reason. The reason is carried through
-- a transaction-local setting by the dedicated RPC, so the audit trigger and
-- the direct-update guard see the same value without adding mutable columns to
-- orders or trusting a UI-only check.
CREATE OR REPLACE FUNCTION public.enforce_order_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reason text;
BEGIN
  IF OLD.state = NEW.state THEN RETURN NEW; END IF;

  IF NEW.state IN ('on_hold', 'cancelled', 'disputed') THEN
    v_reason := nullif(trim(current_setting('qajet.stage_reason', true)), '');
    IF v_reason IS NULL THEN
      SELECT nullif(trim(cr.diff->>'reason'), '') INTO v_reason
      FROM public.change_requests cr
      WHERE cr.order_id = NEW.id AND cr.status = 'pending'
      ORDER BY cr.created_at DESC
      LIMIT 1;
    END IF;
    IF v_reason IS NULL OR length(v_reason) < 5 OR length(v_reason) > 2000 THEN
      RAISE EXCEPTION 'Для паузы, отмены или спора нужна причина от 5 до 2000 символов'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF (OLD.state, NEW.state) IN (
    ('draft', 'estimated'), ('estimated', 'prepaid'), ('prepaid', 'rfq_sent'),
    ('rfq_sent', 'quotes_received'), ('rfq_sent', 'cancelled'),
    ('quotes_received', 'plan_proposed'), ('plan_proposed', 'plan_approved'),
    ('plan_proposed', 'awaiting_internal_approval'), ('plan_proposed', 'cancelled'),
    ('awaiting_internal_approval', 'plan_approved'), ('awaiting_internal_approval', 'cancelled'),
    ('plan_approved', 'suppliers_paid'), ('plan_approved', 'on_hold'),
    ('plan_approved', 'cancelled'), ('on_hold', 'plan_approved'),
    ('on_hold', 'awaiting_internal_approval'), ('on_hold', 'suppliers_paid'),
    ('on_hold', 'cancelled'), ('suppliers_paid', 'in_production'),
    ('in_production', 'shipped'), ('shipped', 'delivered'),
    ('delivered', 'accepted'), ('delivered', 'disputed'),
    ('disputed', 'accepted'), ('disputed', 'cancelled'), ('accepted', 'closed')
  ) THEN RETURN NEW; END IF;

  RAISE EXCEPTION 'order_state_transition: % -> % не определён в машине состояний', OLD.state, NEW.state
    USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint

-- Preserve the reason in the immutable stage history. Change-request based
-- pauses read the pending request before it is marked accepted; explicit
-- pause/cancel/dispute actions use the transaction-local value.
CREATE OR REPLACE FUNCTION public.audit_order_stage_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_plan_version integer;
  v_reason text;
BEGIN
  IF OLD.state = NEW.state THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Переход заказа требует аутентифицированного автора';
  END IF;
  SELECT version INTO v_plan_version FROM public.plans WHERE id = NEW.approved_plan_id;
  v_reason := nullif(trim(current_setting('qajet.stage_reason', true)), '');
  IF v_reason IS NULL AND NEW.state IN ('on_hold', 'cancelled', 'disputed') THEN
    SELECT nullif(trim(cr.diff->>'reason'), '') INTO v_reason
    FROM public.change_requests cr
    WHERE cr.order_id = NEW.id AND cr.status = 'pending'
    ORDER BY cr.created_at DESC
    LIMIT 1;
  END IF;
  INSERT INTO public.order_stage_events(order_id, from_state, to_state, actor_user_id, note)
  VALUES (
    NEW.id,
    OLD.state,
    NEW.state,
    auth.uid(),
    format(
      'Переход %s → %s%s%s',
      OLD.state,
      NEW.state,
      CASE WHEN v_plan_version IS NULL THEN '' ELSE format('; версия плана %s (%s)', v_plan_version, NEW.approved_plan_id) END,
      CASE WHEN v_reason IS NULL THEN '' ELSE format('; причина: %s', v_reason) END
    )
  );
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- One RPC is the only application path for exceptional transitions. The
-- existing order actor trigger remains the second authorization boundary.
CREATE OR REPLACE FUNCTION public.advance_order_exception(
  p_order_id uuid,
  p_expected_state public.order_state,
  p_to_state public.order_state,
  p_reason text
) RETURNS public.orders
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders;
BEGIN
  IF auth.uid() IS NULL OR public.current_role() IS NULL THEN
    RAISE EXCEPTION 'Переход требует аутентифицированного пользователя';
  END IF;
  IF p_to_state NOT IN ('on_hold', 'cancelled', 'disputed') THEN
    RAISE EXCEPTION 'Это не исключительный переход';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 OR length(trim(p_reason)) > 2000 THEN
    RAISE EXCEPTION 'Причина должна быть от 5 до 2000 символов';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.state IS DISTINCT FROM p_expected_state THEN
    RAISE EXCEPTION 'Заказ уже изменён — обновите страницу';
  END IF;

  PERFORM set_config('qajet.stage_reason', trim(p_reason), true);
  UPDATE public.orders
  SET state = p_to_state, updated_at = now()
  WHERE id = p_order_id AND state = p_expected_state
  RETURNING * INTO v_order;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заказ уже изменён — обновите страницу'; END IF;
  RETURN v_order;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.advance_order_exception(uuid, public.order_state, public.order_state, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.advance_order_exception(uuid, public.order_state, public.order_state, text) TO authenticated;
--> statement-breakpoint

-- The assignment target is also protected for direct PostgREST updates. A
-- staff member can only be assigned to an active QAJET staff profile; buyer
-- and supplier users can never be written into concierge_user_id.
CREATE OR REPLACE FUNCTION public.guard_concierge_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF current_setting('role', true) NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF public.current_role() NOT IN ('concierge', 'admin') THEN
    RAISE EXCEPTION 'Назначать заказ может только сотрудник QAJET';
  END IF;
  IF NEW.concierge_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = NEW.concierge_user_id
      AND u.is_active
      AND u.role IN ('concierge', 'admin')
      AND u.company_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Можно назначить только активного сотрудника QAJET';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS orders_guard_concierge_assignment ON public.orders;
CREATE TRIGGER orders_guard_concierge_assignment
BEFORE UPDATE OF concierge_user_id ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_concierge_assignment();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.assign_order_concierge(
  p_order_id uuid,
  p_concierge_user_id uuid
) RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders;
  v_actor public.users;
  v_target public.users;
BEGIN
  SELECT * INTO v_actor FROM public.users
  WHERE id = auth.uid() AND is_active AND role IN ('concierge', 'admin');
  IF NOT FOUND THEN RAISE EXCEPTION 'Назначать заказ может только сотрудник QAJET'; END IF;
  IF p_concierge_user_id IS NOT NULL THEN
    SELECT * INTO v_target FROM public.users
    WHERE id = p_concierge_user_id
      AND is_active
      AND role IN ('concierge', 'admin')
      AND company_id IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Сотрудник не найден или отключён'; END IF;
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заказ не найден'; END IF;
  UPDATE public.orders
  SET concierge_user_id = p_concierge_user_id, updated_at = now()
  WHERE id = p_order_id
  RETURNING * INTO v_order;
  INSERT INTO public.messages(thread_id, author_user_id, body)
  SELECT t.id, auth.uid(),
    CASE
      WHEN p_concierge_user_id IS NULL THEN 'Назначение заказа снято.'
      ELSE format('Заказ назначен сотруднику QAJET: %s.', v_target.full_name)
    END
  FROM public.threads t
  WHERE t.order_id = p_order_id AND t.kind = 'internal'
  LIMIT 1;
  RETURN v_order;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.assign_order_concierge(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.assign_order_concierge(uuid, uuid) TO authenticated;
