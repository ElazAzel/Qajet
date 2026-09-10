-- Serialize commission edits with approval; keep aggregate and line in one
-- transaction even when a caller uses PostgREST directly.
CREATE FUNCTION public.guard_plan_line_commission() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_plan public.plans; v_order public.orders;
BEGIN
  IF current_setting('role', true) NOT IN ('authenticated','anon') THEN RETURN NEW; END IF;
  IF coalesce(public.current_role() IN ('concierge','admin'),false) = false THEN RAISE EXCEPTION 'Только консьерж может менять комиссию'; END IF;
  IF NEW.plan_id <> OLD.plan_id OR NEW.line_total_kzt <> OLD.line_total_kzt THEN
    RAISE EXCEPTION 'Для изменения состава или цены создайте новый план';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE approved_plan_id = NEW.plan_id FOR UPDATE;
  SELECT * INTO v_plan FROM public.plans WHERE id = NEW.plan_id FOR UPDATE;
  IF NOT FOUND OR v_plan.status IN ('approved','superseded') OR v_order.state NOT IN ('quotes_received','plan_proposed','awaiting_internal_approval') THEN
    RAISE EXCEPTION 'Комиссия утверждённого плана зафиксирована';
  END IF;
  IF NEW.commission_pct < 21 OR NEW.commission_pct > 24 OR NEW.commission_pct = 'NaN'::real THEN
    RAISE EXCEPTION 'Комиссия по позиции — от 21%% до 24%%';
  END IF;
  NEW.commission_kzt := round(NEW.line_total_kzt * NEW.commission_pct::numeric / 100);
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER plan_lines_guard_commission BEFORE UPDATE ON public.plan_lines
FOR EACH ROW EXECUTE FUNCTION public.guard_plan_line_commission();--> statement-breakpoint
CREATE FUNCTION public.aggregate_plan_commission() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_commission bigint;
BEGIN
  SELECT coalesce(sum(commission_kzt),0) INTO v_commission FROM public.plan_lines WHERE plan_id = NEW.plan_id;
  UPDATE public.plans SET commission_kzt = v_commission,
    total_kzt = total_supplier_kzt + delivery_kzt + v_commission WHERE id = NEW.plan_id;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER plan_lines_aggregate_commission AFTER UPDATE OF commission_pct,commission_kzt ON public.plan_lines
FOR EACH ROW EXECUTE FUNCTION public.aggregate_plan_commission();--> statement-breakpoint
CREATE FUNCTION public.guard_approved_plan() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF current_setting('role', true) NOT IN ('authenticated','anon') THEN RETURN NEW; END IF;
  -- A new version may retire its predecessor without changing its terms.
  IF OLD.status = 'approved' AND NEW.status = 'superseded' AND
    (to_jsonb(NEW) - ARRAY['status','updated_at']) IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','updated_at']) THEN RETURN NEW; END IF;
  IF OLD.status IN ('approved','superseded') AND (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
    RAISE EXCEPTION 'Утверждённый или заменённый план нельзя менять';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER plans_guard_approved BEFORE UPDATE ON public.plans
FOR EACH ROW EXECUTE FUNCTION public.guard_approved_plan();
