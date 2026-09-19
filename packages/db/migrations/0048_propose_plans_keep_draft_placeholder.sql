-- Первое предложение плана падало: «План не сходится: строки 0, supplier 0…».
-- Воспроизведено packages/db/src/__tests__/plan-proposal.test.ts.
--
-- propose_order_plans переводил прежний план заказа в 'superseded'. При первом
-- предложении прежний план — пустая заглушка-черновик из intake_request. Отложенный
-- триггер plans_reconciliation_deferred видит план не в статусе draft и без строк и
-- откатывает всю транзакцию, поэтому «Предложить этот план» на свежем заказе не
-- работало. Теперь заменяются только планы, которые уже не черновики.
CREATE OR REPLACE FUNCTION public.propose_order_plans(p_order_id uuid, p_expected_state order_state, p_plans jsonb, p_rejections jsonb, p_selected_kind plan_kind)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_order public.orders;
  v_old_plan_id uuid;
  v_plan jsonb;
  v_plan_id uuid;
  v_selected_plan_id uuid;
  v_version integer;
  v_line record;
  v_rejection record;
BEGIN
  IF coalesce(public.current_role() IN ('concierge', 'admin'), false) = false THEN
    RAISE EXCEPTION 'Только консьерж может предложить план';
  END IF;
  IF jsonb_typeof(p_plans) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_plans) = 0
    OR jsonb_array_length(p_plans) > 3
    OR jsonb_typeof(coalesce(p_rejections, '[]'::jsonb)) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Варианты плана указаны некорректно';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.state IS DISTINCT FROM p_expected_state
    OR v_order.state <> 'quotes_received' THEN
    RAISE EXCEPTION 'Заказ уже изменён или ещё не получил КП';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_plans) AS candidate
    WHERE candidate->>'kind' = p_selected_kind::text
  ) THEN
    RAISE EXCEPTION 'Выбранный вариант отсутствует среди допустимых планов';
  END IF;
  SELECT coalesce(max(version), 0) + 1 INTO v_version
  FROM public.plans WHERE request_id = v_order.request_id;
  v_old_plan_id := v_order.approved_plan_id;

  FOR v_plan IN SELECT value FROM jsonb_array_elements(p_plans) LOOP
    IF jsonb_typeof(v_plan) IS DISTINCT FROM 'object'
      OR (v_plan->>'kind')::text NOT IN ('recommended', 'cheaper', 'more_slack')
      OR jsonb_typeof(coalesce(v_plan->'lines', '[]'::jsonb)) IS DISTINCT FROM 'array'
      OR jsonb_array_length(coalesce(v_plan->'lines', '[]'::jsonb)) = 0 THEN
      RAISE EXCEPTION 'Каждый вариант должен содержать допустимые строки';
    END IF;
    INSERT INTO public.plans(
      request_id, version, kind, total_supplier_kzt, delivery_kzt, commission_kzt,
      commission_base, tax_effect_kzt, supplier_rebate_kzt, total_kzt, eta_date, slack_days,
      supplier_count, explanation, status
    ) VALUES (
      v_order.request_id, v_version, (v_plan->>'kind')::public.plan_kind,
      (v_plan->>'total_supplier_kzt')::numeric::bigint,
      (v_plan->>'delivery_kzt')::numeric::bigint,
      (v_plan->>'commission_kzt')::numeric::bigint,
      v_plan->>'commission_base',
      coalesce(nullif(v_plan->>'tax_effect_kzt', '')::numeric::bigint, 0),
      coalesce(nullif(v_plan->>'supplier_rebate_kzt', '')::numeric::bigint, 0),
      (v_plan->>'total_kzt')::numeric::bigint,
      nullif(v_plan->>'eta_date', '')::date,
      nullif(v_plan->>'slack_days', '')::integer,
      (v_plan->>'supplier_count')::integer,
      coalesce(v_plan->'explanation', '{}'::jsonb), 'proposed'
    ) RETURNING id INTO v_plan_id;
    IF (v_plan->>'kind')::public.plan_kind = p_selected_kind THEN
      v_selected_plan_id := v_plan_id;
    END IF;

    FOR v_line IN SELECT * FROM jsonb_to_recordset(v_plan->'lines') AS x(
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
  END LOOP;
  IF v_selected_plan_id IS NULL THEN
    RAISE EXCEPTION 'Не удалось сохранить выбранный вариант';
  END IF;
  IF v_old_plan_id IS NOT NULL THEN
    -- Пустая заглушка-черновик (её создаёт intake_request, чтобы у заказа был план)
    -- не заменяется: сверка требует строк у любого плана не в статусе draft.
    UPDATE public.plans SET status = 'superseded', updated_at = now()
    WHERE id = v_old_plan_id AND status <> 'draft';
  END IF;

  FOR v_rejection IN SELECT * FROM jsonb_to_recordset(coalesce(p_rejections, '[]'::jsonb)) AS x(
    quote_line_id uuid, reason_code text, reason_human text
  ) LOOP
    INSERT INTO public.plan_rejections(request_id, plan_context, quote_line_id, reason_code, reason_human)
      VALUES (v_order.request_id, 'concierge_propose', v_rejection.quote_line_id,
        v_rejection.reason_code, v_rejection.reason_human);
  END LOOP;
  UPDATE public.orders
  SET approved_plan_id = v_selected_plan_id, state = 'plan_proposed', updated_at = now()
  WHERE id = v_order.id AND state = p_expected_state;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заказ уже изменён — обновите страницу'; END IF;
  RETURN v_selected_plan_id;
END;
$function$;
