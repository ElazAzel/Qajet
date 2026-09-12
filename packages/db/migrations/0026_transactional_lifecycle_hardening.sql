-- Transactional lifecycle hardening.
-- The application computes plans and estimates in TypeScript, then hands the
-- already-validated values to these invoker RPCs. PostgreSQL owns the write
-- boundary: the order row is locked first and every dependent write commits
-- or rolls back with the state transition.

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
  IF p_is_active IS NULL OR (p_approval_limit_kzt IS NOT NULL AND p_approval_limit_kzt < 0) THEN
    RAISE EXCEPTION 'set_team_member_access: некорректный лимит или статус';
  END IF;

  SELECT * INTO v_row FROM public.users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_team_member_access: сотрудник % не найден', p_user_id;
  END IF;
  IF v_row.company_id IS DISTINCT FROM v_caller.company_id THEN
    RAISE EXCEPTION 'set_team_member_access: сотрудник не из вашей компании';
  END IF;
  IF p_user_id = v_caller.id AND p_is_active = false THEN
    RAISE EXCEPTION 'set_team_member_access: нельзя отозвать доступ у самого себя';
  END IF;

  UPDATE public.users
  SET approval_limit_kzt = p_approval_limit_kzt,
      is_active = p_is_active,
      deactivated_at = CASE
        WHEN p_is_active THEN NULL
        ELSE COALESCE(deactivated_at, now())
      END,
      updated_at = now()
  WHERE id = p_user_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.split_request_item(p_item_id uuid, p_parts jsonb)
RETURNS SETOF public.request_items
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_original public.request_items;
  v_part jsonb;
  v_new public.request_items;
  v_total bigint := 0;
  v_qty numeric;
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
    v_qty := (v_part->>'qty')::numeric;
    IF nullif(trim(v_part->>'name'),'') IS NULL OR jsonb_typeof(v_part->'qty') IS DISTINCT FROM 'number'
      OR v_qty <= 0 OR v_qty <> trunc(v_qty) THEN
      RAISE EXCEPTION 'Нужны название и целое положительное количество';
    END IF;
    v_total := v_total + v_qty::bigint;
    INSERT INTO public.request_items(request_id,name,category,qty,unit,specs,required_capabilities,needs_clarification,clarification_reason)
      VALUES(v_original.request_id,trim(v_part->>'name'),coalesce(nullif(trim(v_part->>'category'),''),v_original.category),
        v_qty::integer,v_original.unit,v_original.specs,v_original.required_capabilities,true,
        'Создано разделением позиции — требуется подтверждение каталожной позиции') RETURNING * INTO v_new;
    RETURN NEXT v_new;
  END LOOP;
  IF v_total <> v_original.qty THEN
    RAISE EXCEPTION 'Сумма частей (%) должна равняться исходному количеству (%)', v_total, v_original.qty;
  END IF;
  DELETE FROM public.request_items WHERE id = p_item_id;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.get_rfq_quick_response(p_rfq_id uuid, p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rfq public.rfqs;
  v_request public.requests;
  v_items jsonb;
BEGIN
  SELECT r.* INTO v_rfq
  FROM public.rfqs r
  JOIN public.companies c ON c.id = r.supplier_company_id
  WHERE r.id = p_rfq_id
    AND r.token = p_token
    AND r.status IN ('sent', 'quick_responded', 'quoted', 'declined')
    AND (r.respond_by IS NULL OR r.respond_by > now())
    AND c.type = 'supplier' AND c.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ссылка RFQ недействительна, просрочена или уже закрыта';
  END IF;

  SELECT r.* INTO v_request FROM public.requests r WHERE r.id = v_rfq.request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заявка RFQ не найдена'; END IF;
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object('id', i.id, 'name', i.name, 'qty', i.qty, 'unit', i.unit, 'category', i.category)
      ORDER BY i.created_at, i.id
    ), '[]'::jsonb
  ) INTO v_items
  FROM public.request_items i WHERE i.request_id = v_request.id;

  RETURN jsonb_build_object(
    'rfqId', v_rfq.id,
    'status', v_rfq.status,
    'respondBy', v_rfq.respond_by,
    'request', jsonb_build_object('title', v_request.title, 'deadlineDate', v_request.deadline_date),
    'items', v_items
  );
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.quick_respond_rfq_public(p_rfq_id uuid, p_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_status public.rfq_status;
BEGIN
  SELECT r.status INTO v_status
  FROM public.rfqs r
  JOIN public.companies c ON c.id = r.supplier_company_id
  WHERE r.id = p_rfq_id AND r.token = p_token
    AND (r.respond_by IS NULL OR r.respond_by > now())
    AND c.type = 'supplier' AND c.is_active
  FOR UPDATE OF r;
  IF NOT FOUND OR v_status NOT IN ('sent', 'quick_responded') THEN
    RAISE EXCEPTION 'Ссылка RFQ недействительна, просрочена или уже закрыта';
  END IF;
  IF v_status = 'sent' THEN
    UPDATE public.rfqs SET status = 'quick_responded' WHERE id = p_rfq_id;
  END IF;
  RETURN true;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.decline_rfq_public(p_rfq_id uuid, p_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_status public.rfq_status;
BEGIN
  SELECT r.status INTO v_status
  FROM public.rfqs r
  JOIN public.companies c ON c.id = r.supplier_company_id
  WHERE r.id = p_rfq_id AND r.token = p_token
    AND (r.respond_by IS NULL OR r.respond_by > now())
    AND c.type = 'supplier' AND c.is_active
  FOR UPDATE OF r;
  IF NOT FOUND OR v_status NOT IN ('sent', 'quick_responded') THEN
    RAISE EXCEPTION 'Ссылка RFQ недействительна, просрочена или уже закрыта';
  END IF;
  UPDATE public.rfqs SET status = 'declined' WHERE id = p_rfq_id;
  RETURN true;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.submit_rfq_public(p_rfq_id uuid, p_token text, p_lines jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rfq public.rfqs;
  v_quote uuid;
  v_line jsonb;
  v_item_id uuid;
  v_value numeric;
  v_min_qty integer;
  v_setup_fee bigint;
  v_field_flags jsonb;
BEGIN
  SELECT r.* INTO v_rfq
  FROM public.rfqs r
  JOIN public.companies c ON c.id = r.supplier_company_id
  WHERE r.id = p_rfq_id AND r.token = p_token
    AND r.status IN ('sent', 'quick_responded')
    AND (r.respond_by IS NULL OR r.respond_by > now())
    AND c.type = 'supplier' AND c.is_active
  FOR UPDATE OF r;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ссылка RFQ недействительна, просрочена или уже закрыта';
  END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Укажите хотя бы одну позицию КП';
  END IF;

  INSERT INTO public.quotes(rfq_id, source) VALUES (p_rfq_id, 'form') RETURNING id INTO v_quote;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    IF jsonb_typeof(v_line) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Каждая строка КП должна быть объектом';
    END IF;
    IF jsonb_typeof(v_line->'unitPriceKzt') IS DISTINCT FROM 'number'
      OR jsonb_typeof(v_line->'leadTimeDays') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Цена и срок должны быть числами';
    END IF;
    FOR v_value IN SELECT value::text::numeric FROM jsonb_each(v_line)
      WHERE key IN ('unitPriceKzt', 'leadTimeDays', 'setupFeeKzt', 'minQty') AND value <> 'null'::jsonb LOOP
      IF v_value <> trunc(v_value) OR v_value < 0 OR v_value > 9007199254740991 THEN
        RAISE EXCEPTION 'Цена, срок и количество должны быть целыми неотрицательными числами';
      END IF;
    END LOOP;
    v_item_id := (v_line->>'requestItemId')::uuid;
    IF (
      SELECT count(*)
      FROM jsonb_array_elements(p_lines) AS candidate
      WHERE (candidate->>'requestItemId')::uuid = v_item_id
    ) > 1 THEN
      RAISE EXCEPTION 'Каждая позиция должна встречаться в КП только один раз';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.request_items i
      WHERE i.id = v_item_id AND i.request_id = v_rfq.request_id
    ) THEN
      RAISE EXCEPTION 'Позиция не принадлежит этой заявке';
    END IF;
    v_min_qty := (v_line->>'minQty')::numeric::integer;
    v_setup_fee := (v_line->>'setupFeeKzt')::numeric::bigint;
    v_field_flags := '{}'::jsonb;
    IF NOT (v_line ? 'setupFeeKzt') OR v_line->'setupFeeKzt' = 'null'::jsonb THEN
      v_field_flags := v_field_flags || jsonb_build_object('setupFeeKzt', 'missing');
    END IF;
    IF NOT (v_line ? 'minQty') OR v_line->'minQty' = 'null'::jsonb THEN
      v_field_flags := v_field_flags || jsonb_build_object('minQty', 'missing');
    END IF;
    INSERT INTO public.quote_lines(
      quote_id, request_item_id, unit_price_kzt, lead_time_days,
      setup_fee_kzt, min_qty, capability_confirmed, field_flags
    ) VALUES (
      v_quote, v_item_id, (v_line->>'unitPriceKzt')::numeric::bigint,
      (v_line->>'leadTimeDays')::numeric::integer, coalesce(v_setup_fee, 0), v_min_qty, true, v_field_flags
    );
  END LOOP;
  UPDATE public.rfqs SET status = 'quoted' WHERE id = p_rfq_id;
  RETURN v_quote;
END;
$$;--> statement-breakpoint

-- The authenticated supplier path has the same deadline and replay contract
-- as the anonymous RFQ link. Keeping this check in the database prevents a
-- direct PostgREST/RPC call from accepting an expired quote.
CREATE OR REPLACE FUNCTION public.submit_supplier_quote(p_rfq_id uuid, p_lines jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_rfq public.rfqs;
  v_quote uuid;
  v_line jsonb;
  v_item_id uuid;
  v_value numeric;
  v_min_qty integer;
  v_setup_fee bigint;
  v_field_flags jsonb;
BEGIN
  IF public.current_company_id() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.companies
    WHERE id = public.current_company_id() AND type = 'supplier' AND is_active
  ) THEN
    RAISE EXCEPTION 'Только поставщик может ответить на RFQ';
  END IF;
  SELECT * INTO v_rfq
  FROM public.rfqs
  WHERE id = p_rfq_id
    AND supplier_company_id = public.current_company_id()
    AND status IN ('sent', 'quick_responded')
    AND (respond_by IS NULL OR respond_by > now())
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RFQ недоступен, просрочен или уже закрыт'; END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Укажите хотя бы одну позицию КП';
  END IF;
  INSERT INTO public.quotes(rfq_id, source) VALUES (p_rfq_id, 'form') RETURNING id INTO v_quote;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    IF jsonb_typeof(v_line) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Каждая строка КП должна быть объектом';
    END IF;
    IF jsonb_typeof(v_line->'unitPriceKzt') IS DISTINCT FROM 'number'
      OR jsonb_typeof(v_line->'leadTimeDays') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Цена и срок должны быть числами';
    END IF;
    FOR v_value IN SELECT value::text::numeric FROM jsonb_each(v_line)
      WHERE key IN ('unitPriceKzt', 'leadTimeDays', 'setupFeeKzt', 'minQty') AND value <> 'null'::jsonb LOOP
      IF v_value <> trunc(v_value) OR v_value < 0 OR v_value > 9007199254740991 THEN
        RAISE EXCEPTION 'Цена, срок и количество должны быть целыми неотрицательными числами';
      END IF;
    END LOOP;
    v_item_id := (v_line->>'requestItemId')::uuid;
    IF (
      SELECT count(*)
      FROM jsonb_array_elements(p_lines) AS candidate
      WHERE (candidate->>'requestItemId')::uuid = v_item_id
    ) > 1 THEN
      RAISE EXCEPTION 'Каждая позиция должна встречаться в КП только один раз';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.request_items i
      WHERE i.id = v_item_id AND i.request_id = v_rfq.request_id
    ) THEN
      RAISE EXCEPTION 'Позиция не принадлежит этой заявке';
    END IF;
    v_min_qty := (v_line->>'minQty')::numeric::integer;
    v_setup_fee := (v_line->>'setupFeeKzt')::numeric::bigint;
    v_field_flags := '{}'::jsonb;
    IF NOT (v_line ? 'setupFeeKzt') OR v_line->'setupFeeKzt' = 'null'::jsonb THEN
      v_field_flags := v_field_flags || jsonb_build_object('setupFeeKzt', 'missing');
    END IF;
    IF NOT (v_line ? 'minQty') OR v_line->'minQty' = 'null'::jsonb THEN
      v_field_flags := v_field_flags || jsonb_build_object('minQty', 'missing');
    END IF;
    INSERT INTO public.quote_lines(
      quote_id, request_item_id, unit_price_kzt, lead_time_days,
      setup_fee_kzt, min_qty, capability_confirmed, field_flags
    ) VALUES (
      v_quote, v_item_id, (v_line->>'unitPriceKzt')::numeric::bigint,
      (v_line->>'leadTimeDays')::numeric::integer,
      coalesce(v_setup_fee, 0), v_min_qty, true, v_field_flags
    );
  END LOOP;
  UPDATE public.rfqs SET status = 'quoted' WHERE id = p_rfq_id;
  RETURN v_quote;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.submit_supplier_quote(uuid, jsonb) FROM public, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.submit_supplier_quote(uuid, jsonb) TO authenticated;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.decline_supplier_rfq(p_rfq_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_rfq public.rfqs;
BEGIN
  IF public.current_company_id() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.companies
    WHERE id = public.current_company_id() AND type = 'supplier' AND is_active
  ) THEN
    RAISE EXCEPTION 'Только поставщик может отказаться от RFQ';
  END IF;
  SELECT * INTO v_rfq
  FROM public.rfqs
  WHERE id = p_rfq_id
    AND supplier_company_id = public.current_company_id()
    AND status IN ('sent', 'quick_responded')
    AND (respond_by IS NULL OR respond_by > now())
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RFQ недоступен, просрочен или уже закрыт'; END IF;
  UPDATE public.rfqs SET status = 'declined' WHERE id = p_rfq_id;
  RETURN true;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.decline_supplier_rfq(uuid) FROM public, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.decline_supplier_rfq(uuid) TO authenticated;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.create_request_with_items(
  p_title text,
  p_raw_text text,
  p_deadline_date date,
  p_budget_kzt bigint,
  p_delivery_address text,
  p_city text,
  p_items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_company_id uuid;
  v_request_id uuid;
  v_item record;
BEGIN
  SELECT u.company_id INTO v_company_id
  FROM public.users u
  JOIN public.companies c ON c.id = u.company_id
  WHERE u.id = auth.uid() AND u.is_active AND u.role IN ('owner', 'manager')
    AND c.type = 'buyer' AND c.is_active;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Только активный покупатель может создать заявку';
  END IF;
  IF nullif(trim(p_title), '') IS NULL OR p_items IS NULL
    OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Заявка должна содержать название и хотя бы одну позицию';
  END IF;
  IF p_budget_kzt IS NOT NULL AND p_budget_kzt < 0 THEN
    RAISE EXCEPTION 'Бюджет не может быть отрицательным';
  END IF;

  INSERT INTO public.requests(
    buyer_company_id, created_by, title, raw_text, deadline_date,
    budget_kzt, delivery_address, city, status
  ) VALUES (
    v_company_id, auth.uid(), trim(p_title), coalesce(p_raw_text, ''), p_deadline_date,
    p_budget_kzt, nullif(trim(p_delivery_address), ''), nullif(trim(p_city), ''), 'submitted'
  ) RETURNING id INTO v_request_id;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
    name text, category text, qty integer, unit text, specs jsonb, required_capabilities text[]
  ) LOOP
    IF nullif(trim(v_item.name), '') IS NULL OR nullif(trim(v_item.category), '') IS NULL
      OR nullif(trim(v_item.unit), '') IS NULL OR v_item.qty IS NULL OR v_item.qty <= 0 THEN
      RAISE EXCEPTION 'Позиция заявки указана некорректно';
    END IF;
    INSERT INTO public.request_items(
      request_id, name, category, qty, unit, specs, required_capabilities
    ) VALUES (
      v_request_id, trim(v_item.name), trim(v_item.category), v_item.qty,
      trim(v_item.unit), coalesce(v_item.specs, '{}'::jsonb), coalesce(v_item.required_capabilities, '{}'::text[])
    );
  END LOOP;
  RETURN v_request_id;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.create_request_with_items(text,text,date,bigint,text,text,jsonb) FROM public, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.create_request_with_items(text,text,date,bigint,text,text,jsonb) TO authenticated;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.intake_request(p_request_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_request public.requests;
  v_existing uuid;
  v_plan uuid;
  v_order uuid;
BEGIN
  IF coalesce(public.current_role() IN ('concierge','admin'), false) = false
    OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Только консьерж может взять заявку в работу';
  END IF;
  SELECT * INTO v_request FROM public.requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заявка не найдена'; END IF;
  SELECT id INTO v_existing FROM public.orders WHERE request_id = p_request_id;
  IF v_existing IS NOT NULL THEN RAISE EXCEPTION 'Заявка уже взята в работу'; END IF;

  INSERT INTO public.plans(
    request_id, version, kind, total_supplier_kzt, delivery_kzt, commission_kzt,
    commission_base, tax_effect_kzt, total_kzt, supplier_count, explanation, status
  ) VALUES (
    p_request_id, 1, 'manual', 0, 0, 0, 'supplier_ex_delivery', 0, 0, 0,
    jsonb_build_object('decomposition', jsonb_build_array(), 'notes', jsonb_build_array('Черновик — реальный план появится после получения КП.')),
    'draft'
  ) RETURNING id INTO v_plan;
  INSERT INTO public.orders(request_id, approved_plan_id, state, concierge_user_id)
    VALUES (p_request_id, v_plan, 'draft', auth.uid())
    RETURNING id INTO v_order;
  RETURN v_order;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.intake_request(uuid) FROM public, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.intake_request(uuid) TO authenticated;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.propose_order_plan(
  p_order_id uuid,
  p_expected_state public.order_state,
  p_plan jsonb,
  p_lines jsonb,
  p_rejections jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders;
  v_plan_id uuid;
  v_version integer;
  v_line record;
  v_rejection record;
BEGIN
  IF coalesce(public.current_role() IN ('concierge','admin'), false) = false THEN
    RAISE EXCEPTION 'Только консьерж может предложить план';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.state IS DISTINCT FROM p_expected_state THEN
    RAISE EXCEPTION 'Заказ уже изменён — обновите страницу';
  END IF;
  IF v_order.state <> 'quotes_received' OR jsonb_typeof(p_plan) IS DISTINCT FROM 'object'
    OR jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) IS DISTINCT FROM 'array'
    OR jsonb_typeof(coalesce(p_rejections, '[]'::jsonb)) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'План или состояние заказа указаны некорректно';
  END IF;
  SELECT coalesce(max(version), 0) + 1 INTO v_version
  FROM public.plans WHERE request_id = v_order.request_id;

  INSERT INTO public.plans(
    request_id, version, kind, total_supplier_kzt, delivery_kzt, commission_kzt,
    commission_base, tax_effect_kzt, total_kzt, eta_date, slack_days,
    supplier_count, explanation, status
  ) VALUES (
    v_order.request_id, v_version, (p_plan->>'kind')::public.plan_kind,
    (p_plan->>'total_supplier_kzt')::numeric::bigint,
    (p_plan->>'delivery_kzt')::numeric::bigint,
    (p_plan->>'commission_kzt')::numeric::bigint,
    p_plan->>'commission_base', (p_plan->>'tax_effect_kzt')::numeric::bigint,
    (p_plan->>'total_kzt')::numeric::bigint, nullif(p_plan->>'eta_date', '')::date,
    nullif(p_plan->>'slack_days', '')::integer, (p_plan->>'supplier_count')::integer,
    coalesce(p_plan->'explanation', '{}'::jsonb), 'proposed'
  ) RETURNING id INTO v_plan_id;

  IF v_order.approved_plan_id IS NOT NULL THEN
    UPDATE public.plans SET status = 'superseded' WHERE id = v_order.approved_plan_id;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb)) AS x(
    request_item_id uuid, supplier_company_id uuid, quote_line_id uuid, qty integer,
    line_total_kzt bigint, commission_pct real, commission_kzt bigint
  ) LOOP
    INSERT INTO public.plan_lines(
      plan_id, request_item_id, supplier_company_id, quote_line_id, qty,
      line_total_kzt, commission_pct, commission_kzt
    ) VALUES (
      v_plan_id, v_line.request_item_id, v_line.supplier_company_id, v_line.quote_line_id,
      v_line.qty, v_line.line_total_kzt, v_line.commission_pct, v_line.commission_kzt
    );
  END LOOP;

  FOR v_rejection IN SELECT * FROM jsonb_to_recordset(coalesce(p_rejections, '[]'::jsonb)) AS x(
    quote_line_id uuid, reason_code text, reason_human text
  ) LOOP
    INSERT INTO public.plan_rejections(request_id, plan_context, quote_line_id, reason_code, reason_human)
      VALUES (v_order.request_id, 'concierge_propose', v_rejection.quote_line_id,
        v_rejection.reason_code, v_rejection.reason_human);
  END LOOP;

  UPDATE public.orders
  SET approved_plan_id = v_plan_id, state = 'plan_proposed'
  WHERE id = v_order.id AND state = p_expected_state;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заказ уже изменён — обновите страницу'; END IF;
  RETURN v_plan_id;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.propose_order_plan(uuid,public.order_state,jsonb,jsonb,jsonb) FROM public, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.propose_order_plan(uuid,public.order_state,jsonb,jsonb,jsonb) TO authenticated;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.sync_closed_request_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.state = 'closed' AND OLD.state IS DISTINCT FROM NEW.state THEN
    UPDATE public.requests SET status = 'closed', updated_at = now() WHERE id = NEW.request_id;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS orders_sync_closed_request ON public.orders;--> statement-breakpoint
CREATE TRIGGER orders_sync_closed_request
AFTER UPDATE OF state ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.sync_closed_request_status();--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.advance_order_stage(
  p_order_id uuid,
  p_expected_state public.order_state,
  p_to_state public.order_state,
  p_estimate jsonb,
  p_prepayment jsonb,
  p_rfqs jsonb,
  p_outbox jsonb,
  p_payouts jsonb,
  p_payload jsonb,
  p_close_document jsonb
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders;
  v_row record;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.state IS DISTINCT FROM p_expected_state THEN
    RAISE EXCEPTION 'Заказ уже изменён — обновите страницу';
  END IF;

  IF p_to_state = 'estimated' THEN
    IF p_estimate IS NULL THEN RAISE EXCEPTION 'Нет данных оценки'; END IF;
    INSERT INTO public.estimates(request_id, p50_kzt, p80_kzt, margin_pct, basis)
      VALUES (v_order.request_id, (p_estimate->>'p50_kzt')::numeric::bigint,
        (p_estimate->>'p80_kzt')::numeric::bigint, (p_estimate->>'margin_pct')::real,
        coalesce(p_estimate->'basis', '{}'::jsonb))
      ON CONFLICT (request_id) DO UPDATE SET
        p50_kzt = excluded.p50_kzt, p80_kzt = excluded.p80_kzt,
        margin_pct = excluded.margin_pct, basis = excluded.basis, updated_at = now();
    UPDATE public.requests SET status = 'estimated', updated_at = now() WHERE id = v_order.request_id;
  ELSIF p_to_state = 'prepaid' THEN
    IF p_prepayment IS NULL OR p_prepayment->'document' IS NULL THEN
      RAISE EXCEPTION 'Нет данных предоплаты или счёта';
    END IF;
    INSERT INTO public.prepayments(request_id, amount_kzt, invoice_no, status, paid_at)
      VALUES (v_order.request_id, (p_prepayment->>'amount_kzt')::numeric::bigint,
        p_prepayment->>'invoice_no', (p_prepayment->>'status')::public.prepayment_status,
        nullif(p_prepayment->>'paid_at', '')::timestamptz)
      ON CONFLICT (request_id) DO UPDATE SET
        amount_kzt = excluded.amount_kzt, invoice_no = excluded.invoice_no,
        status = excluded.status, paid_at = excluded.paid_at, updated_at = now();
    INSERT INTO public.documents(order_id, stage, type, url, meta)
      VALUES (v_order.id, 'prepaid', 'prepay_invoice', p_prepayment->'document'->>'url',
        coalesce(p_prepayment->'document'->'meta', '{}'::jsonb));
  ELSIF p_to_state = 'rfq_sent' THEN
    IF jsonb_typeof(coalesce(p_rfqs, '[]'::jsonb)) IS DISTINCT FROM 'array'
      OR jsonb_array_length(coalesce(p_rfqs, '[]'::jsonb)) = 0
      OR jsonb_typeof(coalesce(p_outbox, '[]'::jsonb)) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Нет подготовленных RFQ';
    END IF;
    FOR v_row IN SELECT * FROM jsonb_to_recordset(p_rfqs) AS x(
      id uuid, supplier_company_id uuid, token text, sent_at timestamptz,
      respond_by timestamptz, status public.rfq_status, is_exploration boolean, selection_reason jsonb
    ) LOOP
      INSERT INTO public.rfqs(
        id, request_id, supplier_company_id, token, sent_at, respond_by,
        status, is_exploration, selection_reason
      ) VALUES (
        v_row.id, v_order.request_id, v_row.supplier_company_id, v_row.token,
        v_row.sent_at, v_row.respond_by, v_row.status, v_row.is_exploration,
        coalesce(v_row.selection_reason, '{}'::jsonb)
      );
    END LOOP;
    FOR v_row IN SELECT * FROM jsonb_to_recordset(coalesce(p_outbox, '[]'::jsonb)) AS x(
      channel text, kind text, recipient text, subject text, body text, payload jsonb
    ) LOOP
      INSERT INTO public.outbox(channel, kind, recipient, subject, body, payload, status, attempts)
        VALUES (coalesce(v_row.channel, 'email'), v_row.kind, v_row.recipient, v_row.subject,
          v_row.body, coalesce(v_row.payload, '{}'::jsonb), 'pending', 0);
    END LOOP;
  ELSIF p_to_state = 'suppliers_paid' THEN
    IF jsonb_typeof(coalesce(p_payouts, '[]'::jsonb)) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Нет данных выплат поставщикам';
    END IF;
    FOR v_row IN SELECT * FROM jsonb_to_recordset(p_payouts) AS x(
      supplier_company_id uuid, amount_kzt bigint, status text, paid_at timestamptz
    ) LOOP
      INSERT INTO public.supplier_payouts(order_id, supplier_company_id, amount_kzt, status, paid_at)
        VALUES (v_order.id, v_row.supplier_company_id, v_row.amount_kzt, v_row.status, v_row.paid_at)
      ON CONFLICT (order_id, supplier_company_id) DO UPDATE SET
        amount_kzt = excluded.amount_kzt, status = excluded.status, paid_at = excluded.paid_at,
        updated_at = now();
    END LOOP;
  ELSIF p_to_state = 'closed' THEN
    IF p_close_document IS NULL OR p_close_document->>'url' IS NULL THEN
      RAISE EXCEPTION 'Нет акта закрытия заказа';
    END IF;
    INSERT INTO public.documents(order_id, stage, type, url, meta)
      VALUES (v_order.id, 'closed', 'act', p_close_document->>'url',
        coalesce(p_close_document->'meta', '{}'::jsonb));
  END IF;

  UPDATE public.orders
  SET state = p_to_state,
      accepted_at = CASE WHEN p_to_state = 'accepted'
        THEN coalesce(nullif(p_payload->>'accepted_at', '')::timestamptz, now()) ELSE accepted_at END,
      settlement = CASE WHEN p_to_state = 'closed'
        THEN (p_payload->>'settlement')::public.settlement ELSE settlement END,
      settlement_amount_kzt = CASE WHEN p_to_state = 'closed'
        THEN (p_payload->>'settlement_amount_kzt')::numeric::bigint ELSE settlement_amount_kzt END,
      final_cost_kzt = CASE WHEN p_to_state = 'closed'
        THEN (p_payload->>'final_cost_kzt')::numeric::bigint ELSE final_cost_kzt END,
      closed_at = CASE WHEN p_to_state = 'closed'
        THEN coalesce(nullif(p_payload->>'closed_at', '')::timestamptz, now()) ELSE closed_at END,
      updated_at = now()
  WHERE id = p_order_id AND state = p_expected_state
  RETURNING * INTO v_order;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заказ уже изменён — обновите страницу'; END IF;
  RETURN v_order;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.advance_order_stage(uuid,public.order_state,public.order_state,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) FROM public, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.advance_order_stage(uuid,public.order_state,public.order_state,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) TO authenticated;

-- Direct authenticated writes must obey the same RFQ deadline as the actions.
-- These trigger guards cover callers that bypass the convenience RPCs.
CREATE OR REPLACE FUNCTION public.guard_supplier_quote() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_rfq public.rfqs;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  SELECT * INTO v_rfq FROM public.rfqs WHERE id = NEW.rfq_id FOR UPDATE;
  IF NOT FOUND OR v_rfq.supplier_company_id IS DISTINCT FROM public.current_company_id()
    OR v_rfq.status NOT IN ('sent', 'quick_responded')
    OR (v_rfq.respond_by IS NOT NULL AND v_rfq.respond_by <= now()) THEN
    RAISE EXCEPTION 'RFQ недоступен, просрочен или уже закрыт';
  END IF;
  IF EXISTS (SELECT 1 FROM public.quotes WHERE rfq_id = NEW.rfq_id) THEN
    RAISE EXCEPTION 'На этот RFQ уже отправлено КП';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.guard_supplier_rfq() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'updated_at']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['status', 'updated_at']) THEN
    RAISE EXCEPTION 'Поставщик может менять только статус своего RFQ';
  END IF;
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF OLD.respond_by IS NOT NULL AND OLD.respond_by <= now() THEN
    RAISE EXCEPTION 'Срок ответа на RFQ истёк';
  END IF;
  IF OLD.status NOT IN ('sent', 'quick_responded')
    OR NEW.status NOT IN ('quoted', 'declined', 'quick_responded') THEN
    RAISE EXCEPTION 'На этот RFQ уже дан ответ';
  END IF;
  IF NEW.status = 'quoted' AND NOT EXISTS (
    SELECT 1 FROM public.quotes q
    JOIN public.quote_lines l ON l.quote_id = q.id
    WHERE q.rfq_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Сначала заполните КП';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

-- Acceptance is a buyer decision even when the order came through dispute.
-- Keep the application graph and the direct database path identical.
CREATE OR REPLACE FUNCTION public.guard_order_actor() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role public.user_role;
  v_buyer boolean;
  v_supplier boolean;
  v_limit bigint;
  v_plan public.plans;
BEGIN
  IF current_setting('role', true) NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  SELECT u.role, u.approval_limit_kzt INTO v_role, v_limit
  FROM public.users u WHERE u.id = auth.uid() AND u.is_active;
  IF v_role IS NULL THEN RAISE EXCEPTION 'Профиль недоступен'; END IF;

  v_buyer := v_role IN ('owner', 'manager') AND EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.companies c ON c.id = u.company_id
    JOIN public.requests r ON r.buyer_company_id = c.id
    WHERE u.id = auth.uid() AND c.type = 'buyer' AND c.is_active AND r.id = OLD.request_id
  );
  v_supplier := v_role IN ('owner', 'manager') AND EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.companies c ON c.id = u.company_id
    JOIN public.plan_lines pl ON pl.supplier_company_id = c.id
    WHERE u.id = auth.uid() AND c.type = 'supplier' AND c.is_active AND pl.plan_id = OLD.approved_plan_id
  );

  IF NEW.request_id IS DISTINCT FROM OLD.request_id THEN
    RAISE EXCEPTION 'Нельзя заменить заявку заказа';
  END IF;
  IF v_supplier AND (to_jsonb(NEW) - ARRAY['state', 'updated_at']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['state', 'updated_at']) THEN
    RAISE EXCEPTION 'Поставщик может только подтвердить доставку';
  END IF;
  IF v_buyer AND (to_jsonb(NEW) - ARRAY['state', 'accepted_at', 'closed_at', 'settlement',
    'settlement_amount_kzt', 'final_cost_kzt', 'updated_at']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['state', 'accepted_at', 'closed_at', 'settlement',
    'settlement_amount_kzt', 'final_cost_kzt', 'updated_at']) THEN
    RAISE EXCEPTION 'Покупатель не может менять внутренние поля заказа';
  END IF;

  IF OLD.state = NEW.state THEN
    IF v_buyer AND (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
      RAISE EXCEPTION 'Финансовые поля меняются только при завершении заказа';
    END IF;
    RETURN NEW;
  END IF;

  IF v_role IN ('concierge', 'admin') THEN
    IF OLD.state = 'shipped' AND NEW.state = 'delivered' THEN
      RAISE EXCEPTION 'Доставку подтверждает поставщик';
    ELSIF NEW.state IN ('plan_approved', 'awaiting_internal_approval')
      OR (OLD.state IN ('delivered', 'disputed') AND NEW.state = 'accepted') THEN
      RAISE EXCEPTION 'Этот переход выполняет другой участник процесса';
    END IF;
  ELSIF v_buyer THEN
    IF NOT ((OLD.state, NEW.state) IN (
      ('plan_proposed', 'plan_approved'),
      ('plan_proposed', 'awaiting_internal_approval'),
      ('awaiting_internal_approval', 'plan_approved'),
      ('rfq_sent', 'cancelled'),
      ('plan_proposed', 'cancelled'),
      ('awaiting_internal_approval', 'cancelled'),
      ('delivered', 'accepted'),
      ('delivered', 'disputed'),
      ('disputed', 'accepted'),
      ('accepted', 'closed')
    )) THEN
      RAISE EXCEPTION 'Покупатель не может выполнить этот переход';
    END IF;
  ELSIF v_supplier THEN
    IF (OLD.state, NEW.state) <> ('shipped', 'delivered') THEN
      RAISE EXCEPTION 'Поставщик может только подтвердить доставку';
    END IF;
  ELSE
    RAISE EXCEPTION 'Роль не может менять стадии заказа';
  END IF;

  SELECT * INTO v_plan FROM public.plans WHERE id = NEW.approved_plan_id;
  IF NEW.state = 'plan_approved' THEN
    IF EXISTS (SELECT 1 FROM public.permissions WHERE user_id = auth.uid()
      AND key = 'can_approve_plan' AND value <> 'true'::jsonb) THEN
      RAISE EXCEPTION 'Право утверждать планы отозвано';
    END IF;
    IF v_plan.status IS DISTINCT FROM 'approved' OR v_plan.request_id IS DISTINCT FROM NEW.request_id THEN
      RAISE EXCEPTION 'Сначала утвердите актуальный план';
    END IF;
    IF v_role = 'manager' AND v_plan.total_kzt > coalesce(v_limit, 0) THEN
      RAISE EXCEPTION 'Сумма превышает лимит менеджера';
    END IF;
  END IF;

  IF NEW.state IN ('suppliers_paid', 'in_production', 'shipped', 'delivered', 'accepted', 'closed') THEN
    IF v_plan.id IS NULL OR v_plan.status IS DISTINCT FROM 'approved'
      OR NOT EXISTS (SELECT 1 FROM public.plan_lines pl WHERE pl.plan_id = v_plan.id)
      OR EXISTS (
        SELECT 1 FROM (SELECT DISTINCT supplier_company_id FROM public.plan_lines WHERE plan_id = v_plan.id) required
        WHERE NOT EXISTS (
          SELECT 1 FROM public.supplier_payouts sp
          WHERE sp.order_id = NEW.id AND sp.supplier_company_id = required.supplier_company_id AND sp.status = 'paid'
        )
      ) THEN
      RAISE EXCEPTION 'До исполнения нужны утверждённый план и подтверждённые выплаты поставщикам';
    END IF;
  END IF;

  IF NEW.state = 'delivered' AND (
    NOT EXISTS (SELECT 1 FROM public.order_supplier_deliveries d
      WHERE d.order_id = NEW.id AND d.supplier_company_id = public.current_company_id())
    OR EXISTS (
      SELECT 1 FROM (SELECT DISTINCT supplier_company_id FROM public.plan_lines WHERE plan_id = v_plan.id) required
      WHERE NOT EXISTS (SELECT 1 FROM public.order_supplier_deliveries d
        WHERE d.order_id = NEW.id AND d.supplier_company_id = required.supplier_company_id)
    )
  ) THEN
    RAISE EXCEPTION 'Доставку должны подтвердить все поставщики плана';
  END IF;

  IF NEW.state = 'closed' THEN
    IF v_plan.id IS NULL OR NEW.settlement IS NULL OR NEW.settlement_amount_kzt IS NULL
      OR (NEW.settlement = 'refund' AND NEW.settlement_amount_kzt >= 0)
      OR (NEW.settlement = 'surcharge' AND NEW.settlement_amount_kzt <= 0)
      OR (NEW.settlement = 'exact' AND NEW.settlement_amount_kzt <> 0)
      OR NEW.final_cost_kzt IS DISTINCT FROM (v_plan.total_kzt + NEW.settlement_amount_kzt)
      OR NEW.final_cost_kzt < 0 THEN
      RAISE EXCEPTION 'Некорректные суммы сверки';
    END IF;
  ELSIF (NEW.settlement, NEW.settlement_amount_kzt, NEW.final_cost_kzt, NEW.closed_at)
    IS DISTINCT FROM (OLD.settlement, OLD.settlement_amount_kzt, OLD.final_cost_kzt, OLD.closed_at) THEN
    RAISE EXCEPTION 'Сверка доступна только при завершении заказа';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

-- A failed transition must never leave the request status behind the order.
-- The trigger is SECURITY DEFINER because a buyer may close their order while
-- request status remains an internal field.
