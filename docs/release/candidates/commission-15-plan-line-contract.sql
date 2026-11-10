-- Candidate only: reconcile the INSERT/UPDATE contract with migration 0062.
-- No stored plan lines, approved totals or historical percentages are rewritten.
-- The existing trigger, restrictive grants and empty search_path are preserved.
-- Verify the deployed migration ledger before assigning/applying this migration.

CREATE OR REPLACE FUNCTION public.guard_plan_line_contract() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_plan public.plans;
  v_item public.request_items;
  v_quote_line public.quote_lines;
  v_rfq public.rfqs;
  v_expected_commission bigint;
BEGIN
  IF current_setting('role', true) NOT IN ('authenticated', 'anon') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1 FROM public.plans p
      WHERE p.id = OLD.plan_id AND p.status IN ('approved', 'superseded')
    ) THEN
      RAISE EXCEPTION 'Строки утверждённого плана нельзя удалять';
    END IF;
    RETURN OLD;
  END IF;

  -- Keep the legacy direct staff update ergonomic: when a caller changes only
  -- the percentage, derive the corresponding line amount before validating
  -- the invariant. An explicitly supplied conflicting amount is still
  -- rejected below.
  IF TG_OP = 'UPDATE'
    AND NEW.commission_pct IS DISTINCT FROM OLD.commission_pct
    AND NEW.commission_kzt IS NOT DISTINCT FROM OLD.commission_kzt THEN
    NEW.commission_kzt := round(NEW.line_total_kzt::numeric * NEW.commission_pct::numeric / 100)::bigint;
  END IF;

  SELECT * INTO v_plan FROM public.plans WHERE id = NEW.plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'План строки не найден'; END IF;
  IF NEW.line_total_kzt < 0 OR NEW.commission_pct IS NULL
    OR NEW.commission_pct = 'NaN'::real
    OR NEW.commission_pct < 10 OR NEW.commission_pct > 15 THEN
    RAISE EXCEPTION 'Строка плана содержит некорректную стоимость или комиссию';
  END IF;
  SELECT * INTO v_item FROM public.request_items WHERE id = NEW.request_item_id;
  IF NOT FOUND OR v_item.request_id IS DISTINCT FROM v_plan.request_id
    OR NEW.qty IS DISTINCT FROM v_item.qty THEN
    RAISE EXCEPTION 'Строка плана не совпадает с позицией заявки';
  END IF;
  SELECT * INTO v_quote_line FROM public.quote_lines WHERE id = NEW.quote_line_id;
  IF NOT FOUND OR v_quote_line.request_item_id IS DISTINCT FROM NEW.request_item_id THEN
    RAISE EXCEPTION 'Строка плана ссылается на чужую строку КП';
  END IF;
  SELECT r.* INTO v_rfq
  FROM public.rfqs r
  JOIN public.quotes q ON q.rfq_id = r.id
  WHERE q.id = v_quote_line.quote_id;
  IF NOT FOUND OR v_rfq.request_id IS DISTINCT FROM v_plan.request_id
    OR v_rfq.supplier_company_id IS DISTINCT FROM NEW.supplier_company_id THEN
    RAISE EXCEPTION 'Поставщик строки плана не совпадает с RFQ';
  END IF;
  v_expected_commission := round(NEW.line_total_kzt::numeric * NEW.commission_pct::numeric / 100)::bigint;
  -- The engine allocates the already-rounded aggregate with largest
  -- remainder, so a line may differ from its independently rounded value by
  -- one tenge. A larger difference is not a legitimate rounding choice.
  IF abs(NEW.commission_kzt - v_expected_commission) > 1 THEN
    RAISE EXCEPTION 'Комиссия строки не соответствует сохранённому проценту';
  END IF;
  IF v_plan.status IN ('approved', 'superseded') AND TG_OP = 'UPDATE'
    AND (
      NEW.plan_id IS DISTINCT FROM OLD.plan_id OR
      NEW.request_item_id IS DISTINCT FROM OLD.request_item_id OR
      NEW.supplier_company_id IS DISTINCT FROM OLD.supplier_company_id OR
      NEW.quote_line_id IS DISTINCT FROM OLD.quote_line_id OR
      NEW.qty IS DISTINCT FROM OLD.qty OR
      NEW.line_total_kzt IS DISTINCT FROM OLD.line_total_kzt OR
      NEW.commission_pct IS DISTINCT FROM OLD.commission_pct OR
      NEW.commission_kzt IS DISTINCT FROM OLD.commission_kzt
    ) THEN
    RAISE EXCEPTION 'Утверждённый или заменённый план нельзя менять';
  END IF;
  RETURN NEW;
END;
$$;
