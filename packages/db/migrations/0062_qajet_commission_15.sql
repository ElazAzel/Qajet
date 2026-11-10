-- QAJET: 15% standard markup for new plans; legacy approved plans remain unchanged.
-- Existing per-line percentages are historical contract snapshots and are NOT rewritten.
ALTER TABLE public.plan_lines ALTER COLUMN commission_pct SET DEFAULT 15;
--> statement-breakpoint
UPDATE public.settings SET value = '15'::jsonb WHERE key = 'commission_rate_pct';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_plan_line_commission() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_plan public.plans; v_order public.orders;
BEGIN
  IF current_setting('role', true) NOT IN ('authenticated','anon') THEN RETURN NEW; END IF;
  IF coalesce(public.current_role() IN ('concierge','admin'),false) = false THEN
    RAISE EXCEPTION 'Только консьерж может менять комиссию';
  END IF;
  IF NEW.plan_id <> OLD.plan_id OR NEW.line_total_kzt <> OLD.line_total_kzt THEN
    RAISE EXCEPTION 'Для изменения состава или цены создайте новый план';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE approved_plan_id = NEW.plan_id FOR UPDATE;
  SELECT * INTO v_plan FROM public.plans WHERE id = NEW.plan_id FOR UPDATE;
  IF NOT FOUND OR v_plan.status IN ('approved','superseded')
    OR v_order.state NOT IN ('quotes_received','plan_proposed','awaiting_internal_approval') THEN
    RAISE EXCEPTION 'Комиссия утверждённого плана зафиксирована';
  END IF;
  IF NEW.commission_pct IS NULL
    OR NEW.commission_pct = 'NaN'::real
    OR NEW.commission_pct < 10 OR NEW.commission_pct > 15 THEN
    RAISE EXCEPTION 'Комиссия по позиции — от 10%% до 15%%';
  END IF;
  NEW.commission_kzt := round(NEW.line_total_kzt * NEW.commission_pct::numeric / 100);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.update_plan_line_commission(
  p_plan_line_id uuid,
  p_commission_pct real
) RETURNS public.plan_lines
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_line public.plan_lines;
  v_plan public.plans;
  v_order public.orders;
  v_commission bigint;
  v_plan_commission bigint;
BEGIN
  IF public.current_role() NOT IN ('concierge', 'admin') OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Только сотрудник QAJET может менять комиссию';
  END IF;
  IF p_commission_pct IS NULL OR p_commission_pct = 'NaN'::real
    OR p_commission_pct < 10 OR p_commission_pct > 15 THEN
    RAISE EXCEPTION USING MESSAGE = 'Комиссия по позиции должна быть от 10% до 15%';
  END IF;
  SELECT * INTO v_line FROM public.plan_lines WHERE id = p_plan_line_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Позиция плана не найдена'; END IF;
  SELECT * INTO v_plan FROM public.plans WHERE id = v_line.plan_id FOR UPDATE;
  SELECT * INTO v_order FROM public.orders WHERE approved_plan_id = v_plan.id FOR UPDATE;
  IF NOT FOUND OR v_order.state NOT IN ('plan_proposed', 'awaiting_internal_approval')
    OR v_plan.status <> 'proposed' THEN
    RAISE EXCEPTION 'Комиссию нельзя менять после утверждения плана покупателем';
  END IF;
  v_commission := round(v_line.line_total_kzt::numeric * p_commission_pct / 100)::bigint;
  v_plan_commission := v_plan.commission_kzt - v_line.commission_kzt + v_commission;
  IF v_plan_commission < 0 THEN RAISE EXCEPTION 'Комиссия плана не может быть отрицательной'; END IF;
  UPDATE public.plan_lines
  SET commission_pct = p_commission_pct, commission_kzt = v_commission, updated_at = now()
  WHERE id = v_line.id
  RETURNING * INTO v_line;
  UPDATE public.plans
  SET commission_kzt = v_plan_commission,
      total_kzt = v_plan.total_kzt - v_plan.commission_kzt + v_plan_commission,
      updated_at = now()
  WHERE id = v_plan.id;
  RETURN v_line;
END;
$$;
