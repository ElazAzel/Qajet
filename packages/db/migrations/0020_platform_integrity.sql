-- Enforce integrity at the API boundary as well as in Server Actions.
-- Existing historical rows are preserved; guards apply to subsequent writes.
CREATE FUNCTION public.guard_supplier_quote() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_rfq public.rfqs;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  SELECT * INTO v_rfq FROM public.rfqs WHERE id = NEW.rfq_id FOR UPDATE;
  IF NOT FOUND OR v_rfq.supplier_company_id IS DISTINCT FROM public.current_company_id()
    OR v_rfq.status NOT IN ('sent', 'quick_responded') THEN
    RAISE EXCEPTION 'RFQ недоступен или на него уже дан ответ';
  END IF;
  IF EXISTS (SELECT 1 FROM public.quotes WHERE rfq_id = NEW.rfq_id) THEN
    RAISE EXCEPTION 'На этот RFQ уже отправлено КП';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER quotes_guard_insert BEFORE INSERT ON public.quotes
FOR EACH ROW EXECUTE FUNCTION public.guard_supplier_quote();--> statement-breakpoint
CREATE FUNCTION public.guard_quote_line() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_request uuid; v_status public.rfq_status;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  SELECT r.request_id, r.status INTO v_request, v_status FROM public.quotes q
    JOIN public.rfqs r ON r.id = q.rfq_id WHERE q.id = NEW.quote_id FOR UPDATE OF r;
  IF v_request IS NULL OR v_status NOT IN ('sent', 'quick_responded') OR NOT EXISTS (
    SELECT 1 FROM public.request_items WHERE id = NEW.request_item_id AND request_id = v_request
  ) THEN RAISE EXCEPTION 'Позиция не принадлежит открытой заявке этого RFQ'; END IF;
  IF NEW.unit_price_kzt <= 0 OR NEW.unit_price_kzt > 9007199254740991
    OR NEW.setup_fee_kzt < 0 OR NEW.setup_fee_kzt > 9007199254740991
    OR NEW.lead_time_days <= 0 OR NEW.min_qty <= 0 THEN
    RAISE EXCEPTION 'Некорректная цена, подготовка, количество или срок поставки';
  END IF;
  IF EXISTS (SELECT 1 FROM public.quote_lines WHERE quote_id = NEW.quote_id AND request_item_id = NEW.request_item_id AND id <> NEW.id) THEN
    RAISE EXCEPTION 'Позиция уже добавлена в КП';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER quote_lines_guard_write BEFORE INSERT OR UPDATE ON public.quote_lines
FOR EACH ROW EXECUTE FUNCTION public.guard_quote_line();--> statement-breakpoint
CREATE FUNCTION public.guard_supplier_rfq() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF (to_jsonb(NEW) - ARRAY['status','updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','updated_at']) THEN
    RAISE EXCEPTION 'Поставщик может менять только статус своего RFQ';
  END IF;
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF OLD.status NOT IN ('sent', 'quick_responded') OR NEW.status NOT IN ('quoted', 'declined', 'quick_responded') THEN
    RAISE EXCEPTION 'На этот RFQ уже дан ответ';
  END IF;
  IF NEW.status = 'quoted' AND NOT EXISTS (
    SELECT 1 FROM public.quotes q JOIN public.quote_lines l ON l.quote_id = q.id WHERE q.rfq_id = OLD.id
  ) THEN RAISE EXCEPTION 'Сначала заполните КП'; END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER rfqs_guard_update BEFORE UPDATE ON public.rfqs
FOR EACH ROW EXECUTE FUNCTION public.guard_supplier_rfq();--> statement-breakpoint
CREATE FUNCTION public.submit_supplier_quote(p_rfq_id uuid, p_lines jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_rfq public.rfqs; v_quote uuid; v_line jsonb; v_value numeric;
BEGIN
  IF public.current_company_id() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.companies WHERE id = public.current_company_id() AND type = 'supplier'
  ) THEN RAISE EXCEPTION 'Только поставщик может ответить на RFQ'; END IF;
  SELECT * INTO v_rfq FROM public.rfqs WHERE id = p_rfq_id FOR UPDATE;
  IF NOT FOUND OR v_rfq.supplier_company_id IS DISTINCT FROM public.current_company_id()
    OR v_rfq.status NOT IN ('sent', 'quick_responded') THEN
    RAISE EXCEPTION 'RFQ недоступен или на него уже дан ответ';
  END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Укажите хотя бы одну позицию КП';
  END IF;
  INSERT INTO public.quotes(rfq_id, source) VALUES (p_rfq_id, 'form') RETURNING id INTO v_quote;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    IF jsonb_typeof(v_line->'unitPriceKzt') IS DISTINCT FROM 'number'
      OR jsonb_typeof(v_line->'leadTimeDays') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Цена и срок должны быть числами';
    END IF;
    -- Numeric casts to bigint round fractions: reject them before conversion.
    FOR v_value IN SELECT value::text::numeric FROM jsonb_each(v_line)
      WHERE key IN ('unitPriceKzt','leadTimeDays','setupFeeKzt','minQty') AND value <> 'null'::jsonb LOOP
      IF v_value <> trunc(v_value) OR v_value < 0 OR v_value > 9007199254740991 THEN
        RAISE EXCEPTION 'Цена, срок и количество должны быть целыми неотрицательными числами';
      END IF;
    END LOOP;
    INSERT INTO public.quote_lines(quote_id, request_item_id, unit_price_kzt, lead_time_days, setup_fee_kzt, min_qty, capability_confirmed)
    VALUES (v_quote, (v_line->>'requestItemId')::uuid, (v_line->>'unitPriceKzt')::bigint,
      (v_line->>'leadTimeDays')::integer, coalesce((v_line->>'setupFeeKzt')::bigint, 0),
      (v_line->>'minQty')::integer, true);
  END LOOP;
  UPDATE public.rfqs SET status = 'quoted' WHERE id = p_rfq_id;
  RETURN v_quote;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.submit_supplier_quote(uuid,jsonb) FROM public, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.submit_supplier_quote(uuid,jsonb) TO authenticated;
--> statement-breakpoint
-- SQL graph in 0001 checks legal edges; this independent guard enforces actors
-- and prevents buyers from editing internal/financial columns directly.
CREATE FUNCTION public.guard_order_actor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_role public.user_role; v_buyer boolean; v_limit bigint; v_plan public.plans;
BEGIN
  IF current_setting('role', true) NOT IN ('authenticated','anon') THEN RETURN NEW; END IF;
  SELECT role, approval_limit_kzt INTO v_role, v_limit FROM public.users WHERE id = auth.uid() AND is_active;
  IF v_role IS NULL THEN RAISE EXCEPTION 'Профиль недоступен'; END IF;
  v_buyer := v_role IN ('owner','manager') AND EXISTS (
    SELECT 1 FROM public.requests WHERE id = OLD.request_id AND buyer_company_id = public.current_company_id()
  );
  IF NEW.request_id IS DISTINCT FROM OLD.request_id THEN RAISE EXCEPTION 'Нельзя заменить заявку заказа'; END IF;
  IF v_buyer AND (to_jsonb(NEW) - ARRAY['state','accepted_at','closed_at','settlement','settlement_amount_kzt','final_cost_kzt','updated_at'])
    IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state','accepted_at','closed_at','settlement','settlement_amount_kzt','final_cost_kzt','updated_at']) THEN
    RAISE EXCEPTION 'Покупатель не может менять внутренние поля заказа';
  END IF;
  IF OLD.state = NEW.state THEN
    IF v_buyer AND (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
      RAISE EXCEPTION 'Финансовые поля меняются только при завершении заказа';
    END IF;
    RETURN NEW;
  END IF;
  IF v_role IN ('concierge','admin') THEN
    IF NEW.state IN ('plan_approved','awaiting_internal_approval') OR (OLD.state = 'delivered' AND NEW.state = 'accepted') THEN
      RAISE EXCEPTION 'Это решение принимает покупатель';
    END IF;
  ELSIF v_buyer THEN
    IF NOT ((OLD.state,NEW.state) IN (
      ('plan_proposed','plan_approved'), ('plan_proposed','awaiting_internal_approval'),
      ('awaiting_internal_approval','plan_approved'), ('rfq_sent','cancelled'),
      ('plan_proposed','cancelled'), ('awaiting_internal_approval','cancelled'),
      ('delivered','accepted'), ('delivered','disputed'), ('accepted','closed')
    )) THEN RAISE EXCEPTION 'Покупатель не может выполнить этот переход'; END IF;
  ELSE RAISE EXCEPTION 'Роль не может менять стадии заказа'; END IF;
  SELECT * INTO v_plan FROM public.plans WHERE id = NEW.approved_plan_id;
  IF NEW.state = 'plan_approved' THEN
    IF EXISTS (SELECT 1 FROM public.permissions WHERE user_id = auth.uid() AND key = 'can_approve_plan' AND value <> 'true'::jsonb) THEN
      RAISE EXCEPTION 'Право утверждать планы отозвано';
    END IF;
    IF v_plan.status IS DISTINCT FROM 'approved' OR v_plan.request_id IS DISTINCT FROM NEW.request_id THEN
      RAISE EXCEPTION 'Сначала утвердите актуальный план';
    END IF;
    IF v_role = 'manager' AND v_plan.total_kzt > coalesce(v_limit,0) THEN
      RAISE EXCEPTION 'Сумма превышает лимит менеджера';
    END IF;
  END IF;
  IF NEW.state = 'closed' THEN
    IF v_plan.id IS NULL OR NEW.settlement IS NULL OR NEW.settlement_amount_kzt IS NULL OR
      (NEW.settlement = 'refund' AND NEW.settlement_amount_kzt >= 0) OR
      (NEW.settlement = 'surcharge' AND NEW.settlement_amount_kzt <= 0) OR
      (NEW.settlement = 'exact' AND NEW.settlement_amount_kzt <> 0) OR
      NEW.final_cost_kzt IS DISTINCT FROM (v_plan.total_kzt + NEW.settlement_amount_kzt) OR NEW.final_cost_kzt < 0 THEN
      RAISE EXCEPTION 'Некорректные суммы сверки';
    END IF;
  ELSIF (NEW.settlement,NEW.settlement_amount_kzt,NEW.final_cost_kzt,NEW.closed_at)
    IS DISTINCT FROM (OLD.settlement,OLD.settlement_amount_kzt,OLD.final_cost_kzt,OLD.closed_at) THEN
    RAISE EXCEPTION 'Сверка доступна только при завершении заказа';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER orders_guard_actor BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_order_actor();--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.approve_plan(p_order_id uuid) RETURNS public.plans
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order public.orders; v_plan public.plans; v_user public.users; v_next public.order_state;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE id = auth.uid() AND is_active;
  IF NOT FOUND OR v_user.role NOT IN ('owner','manager') THEN RAISE EXCEPTION 'Только покупатель может утвердить план'; END IF;
  IF EXISTS (SELECT 1 FROM public.permissions WHERE user_id = v_user.id AND key = 'can_approve_plan' AND value <> 'true'::jsonb) THEN
    RAISE EXCEPTION 'Право утверждать планы отозвано';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.requests WHERE id = v_order.request_id AND buyer_company_id = v_user.company_id) THEN
    RAISE EXCEPTION 'Нет доступа к заказу';
  END IF;
  SELECT * INTO v_plan FROM public.plans WHERE id = v_order.approved_plan_id AND request_id = v_order.request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Актуальный план не найден'; END IF;
  IF v_order.state = 'plan_approved' AND v_plan.status = 'approved' THEN RETURN v_plan; END IF;
  IF v_order.state NOT IN ('plan_proposed','awaiting_internal_approval') OR v_plan.status <> 'proposed' THEN
    RAISE EXCEPTION 'План больше не ожидает согласования';
  END IF;
  IF v_user.role = 'owner' AND v_user.approval_limit_kzt IS NOT NULL AND v_plan.total_kzt > v_user.approval_limit_kzt THEN
    RAISE EXCEPTION 'Сумма превышает лимит согласования владельца';
  END IF;
  v_next := CASE WHEN v_user.role = 'manager' AND v_plan.total_kzt > coalesce(v_user.approval_limit_kzt,0)
    THEN 'awaiting_internal_approval'::public.order_state ELSE 'plan_approved'::public.order_state END;
  IF v_next = v_order.state THEN RETURN v_plan; END IF;
  IF v_next = 'plan_approved' THEN
    UPDATE public.plans SET status = 'approved' WHERE id = v_plan.id RETURNING * INTO v_plan;
  END IF;
  UPDATE public.orders SET state = v_next WHERE id = v_order.id;
  INSERT INTO public.order_stage_events(order_id,from_state,to_state,actor_user_id,note)
    VALUES(v_order.id,v_order.state,v_next,v_user.id,
      format('Версия плана %s (%s): %s', v_plan.version, v_plan.id, v_next));
  RETURN v_plan;
END;
$$;--> statement-breakpoint
-- Item edits must freeze at RFQ, including direct PostgREST requests.
CREATE FUNCTION public.guard_request_item_stage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_request uuid; v_order public.orders;
BEGIN
  IF current_setting('role', true) NOT IN ('authenticated','anon') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  v_request := CASE WHEN TG_OP = 'DELETE' THEN OLD.request_id ELSE NEW.request_id END;
  IF TG_OP = 'UPDATE' AND NEW.request_id IS DISTINCT FROM OLD.request_id THEN
    RAISE EXCEPTION 'Нельзя переносить позицию в другую заявку';
  END IF;
  FOR v_order IN SELECT * FROM public.orders WHERE request_id = v_request FOR UPDATE LOOP
    IF v_order.state NOT IN ('draft','estimated','prepaid') THEN
      RAISE EXCEPTION 'Позиции нельзя менять после отправки RFQ';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;--> statement-breakpoint
CREATE TRIGGER request_items_guard_stage BEFORE INSERT OR UPDATE OR DELETE ON public.request_items
FOR EACH ROW EXECUTE FUNCTION public.guard_request_item_stage();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.split_request_item(p_item_id uuid, p_parts jsonb)
RETURNS SETOF public.request_items LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_original public.request_items; v_part jsonb; v_new public.request_items;
BEGIN
  IF coalesce(public.current_role() IN ('concierge','admin'), false) = false THEN
    RAISE EXCEPTION 'Только консьерж может разделять позиции';
  END IF;
  SELECT * INTO v_original FROM public.request_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Позиция не найдена'; END IF;
  IF jsonb_typeof(p_parts) IS DISTINCT FROM 'array' OR jsonb_array_length(p_parts) < 2 THEN
    RAISE EXCEPTION 'Нужно минимум две части';
  END IF;
  FOR v_part IN SELECT * FROM jsonb_array_elements(p_parts) LOOP
    IF nullif(trim(v_part->>'name'),'') IS NULL OR jsonb_typeof(v_part->'qty') IS DISTINCT FROM 'number'
      OR (v_part->>'qty')::numeric <= 0 OR (v_part->>'qty')::numeric <> trunc((v_part->>'qty')::numeric) THEN
      RAISE EXCEPTION 'Нужны название и целое положительное количество';
    END IF;
    INSERT INTO public.request_items(request_id,name,category,qty,unit,specs,required_capabilities,needs_clarification,clarification_reason)
      VALUES(v_original.request_id,trim(v_part->>'name'),coalesce(nullif(trim(v_part->>'category'),''),v_original.category),
        (v_part->>'qty')::integer,v_original.unit,v_original.specs,v_original.required_capabilities,true,
        'Создано разделением позиции — требуется подтверждение категории и количества') RETURNING * INTO v_new;
    RETURN NEXT v_new;
  END LOOP;
  DELETE FROM public.request_items WHERE id = p_item_id;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.merge_request_items(p_item_ids uuid[], p_name text DEFAULT NULL, p_category text DEFAULT NULL)
RETURNS public.request_items LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_first public.request_items; v_new public.request_items; v_count int; v_requests int; v_units int; v_qty bigint;
BEGIN
  IF coalesce(public.current_role() IN ('concierge','admin'), false) = false THEN
    RAISE EXCEPTION 'Только консьерж может объединять позиции';
  END IF;
  IF coalesce(cardinality(p_item_ids),0) < 2 THEN RAISE EXCEPTION 'Нужно минимум две позиции'; END IF;
  PERFORM id FROM public.request_items WHERE id = ANY(p_item_ids) ORDER BY id FOR UPDATE;
  SELECT count(*),count(DISTINCT request_id),count(DISTINCT unit),sum(qty) INTO v_count,v_requests,v_units,v_qty
    FROM public.request_items WHERE id = ANY(p_item_ids);
  IF v_count <> cardinality(p_item_ids) OR v_requests <> 1 OR v_units <> 1 THEN
    RAISE EXCEPTION 'Выберите существующие разные позиции одной заявки с одинаковой единицей измерения';
  END IF;
  SELECT * INTO v_first FROM public.request_items WHERE id = p_item_ids[1];
  INSERT INTO public.request_items(request_id,name,category,qty,unit,specs,required_capabilities,needs_clarification,clarification_reason)
    VALUES(v_first.request_id,coalesce(nullif(trim(p_name),''),v_first.name),coalesce(nullif(trim(p_category),''),v_first.category),
      v_qty,v_first.unit,v_first.specs,v_first.required_capabilities,true,
      'Создано объединением позиций — требуется подтверждение категории и количества') RETURNING * INTO v_new;
  DELETE FROM public.request_items WHERE id = ANY(p_item_ids);
  RETURN v_new;
END;
$$;
