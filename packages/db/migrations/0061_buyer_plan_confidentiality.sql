-- Buyer sessions must never receive supplier cost, commission split or raw
-- explanation JSON (product specification section 7, ADR-0009).
-- Raw plans remain available to active staff and the existing service policy.
-- The application must deploy its safe RPC readers with this migration.
ALTER POLICY "plans_select_via_request" ON public.plans TO authenticated
USING ((SELECT public.current_role()) IN ('concierge', 'admin'));
--> statement-breakpoint

-- A narrow definer read is necessary because buyer SELECT on raw plans is
-- removed. INVOKER cannot read that table. Every row is independently authorized
-- from auth.uid(), active profile, role and active buyer-company membership;
-- no client role/company input or broader request/supplier visibility is used.
-- Preserve the existing company-wide owner/manager scope (not created_by).
-- Only authenticated sessions may execute; no service bypass is needed because
-- service_role already has direct table access. NULL identity/arrays fail closed.
CREATE FUNCTION public.get_buyer_plans(p_request_ids uuid[])
RETURNS TABLE (
  id uuid,
  request_id uuid,
  version integer,
  kind public.plan_kind,
  status public.plan_status,
  delivery_kzt bigint,
  supplier_rebate_kzt bigint,
  total_kzt bigint,
  eta_date date,
  slack_days integer,
  supplier_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p.id, p.request_id, p.version, p.kind, p.status,
    p.delivery_kzt, p.supplier_rebate_kzt, p.total_kzt,
    p.eta_date, p.slack_days, p.supplier_count
  FROM public.plans p
  JOIN public.requests r ON r.id = p.request_id
  WHERE p.request_id = ANY(coalesce(p_request_ids, ARRAY[]::uuid[]))
    AND p.status IN ('draft', 'proposed', 'approved')
    AND EXISTS (
      SELECT 1
      FROM public.users u
      LEFT JOIN public.companies c ON c.id = u.company_id
      WHERE u.id = auth.uid() AND u.is_active
        AND (
          u.role IN ('concierge', 'admin')
          OR (
            u.role IN ('owner', 'manager')
            AND c.type = 'buyer' AND c.is_active
            AND c.id = r.buyer_company_id
          )
        )
    )
  ORDER BY p.version DESC, p.id;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.get_buyer_plans(uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_buyer_plans(uuid[]) TO authenticated;
--> statement-breakpoint

-- Approval is a command: the app consumes only success/error and re-reads the
-- safe DTO. Returning public.plans bypassed RLS, including the idempotent branch.
-- PostgreSQL requires exact DROP/CREATE for a changed return type. Do not CASCADE:
-- an unknown deployment dependency must stop migration rather than be removed.
-- All authorization, locks, limits, optimistic checks and audit behavior remain
-- byte-for-byte as in 0033; only both RETURN payloads are removed.
DROP FUNCTION public.approve_plan(uuid, uuid, integer);
--> statement-breakpoint
CREATE FUNCTION public.approve_plan(
  p_order_id uuid,
  p_expected_plan_id uuid,
  p_expected_plan_version integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders;
  v_plan public.plans;
  v_user public.users;
  v_next public.order_state;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE id = auth.uid() AND is_active;
  IF NOT FOUND OR v_user.role NOT IN ('owner', 'manager') OR NOT EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.id = v_user.company_id AND c.type = 'buyer' AND c.is_active
  ) THEN
    RAISE EXCEPTION 'Только покупатель может утвердить план';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.permissions
    WHERE user_id = v_user.id AND key = 'can_approve_plan' AND value <> 'true'::jsonb
  ) THEN
    RAISE EXCEPTION 'Право утверждать планы отозвано';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.requests
    WHERE id = v_order.request_id AND buyer_company_id = v_user.company_id
  ) THEN
    RAISE EXCEPTION 'Нет доступа к заказу';
  END IF;
  IF v_order.approved_plan_id IS DISTINCT FROM p_expected_plan_id THEN
    RAISE EXCEPTION 'План уже изменён — обновите страницу';
  END IF;
  SELECT * INTO v_plan
  FROM public.plans
  WHERE id = v_order.approved_plan_id AND request_id = v_order.request_id
  FOR UPDATE;
  IF NOT FOUND OR v_plan.version IS DISTINCT FROM p_expected_plan_version THEN
    RAISE EXCEPTION 'Версия плана уже изменена — обновите страницу';
  END IF;
  IF v_order.state = 'plan_approved' AND v_plan.status = 'approved' THEN RETURN; END IF;
  IF v_order.state NOT IN ('plan_proposed', 'awaiting_internal_approval', 'on_hold')
    OR v_plan.status <> 'proposed' THEN
    RAISE EXCEPTION 'План больше не ожидает согласования';
  END IF;
  IF v_user.role = 'owner' AND v_user.approval_limit_kzt IS NOT NULL
    AND v_plan.total_kzt > v_user.approval_limit_kzt THEN
    RAISE EXCEPTION 'Сумма превышает лимит согласования владельца';
  END IF;

  v_next := CASE
    WHEN v_user.role = 'manager' AND v_plan.total_kzt > coalesce(v_user.approval_limit_kzt, 0)
      THEN 'awaiting_internal_approval'::public.order_state
    ELSE 'plan_approved'::public.order_state
  END;
  IF v_next = 'plan_approved' THEN
    UPDATE public.plans
    SET status = 'approved', updated_at = now()
    WHERE id = v_plan.id
    RETURNING * INTO v_plan;
  END IF;
  UPDATE public.orders SET state = v_next, updated_at = now() WHERE id = v_order.id;
  RETURN;
END;
$$;
--> statement-breakpoint
-- Retain the existing authenticated/service execution grant. The definer body
-- still requires an active buyer identity and checks company ownership before
-- any write; the service role does not bypass those command checks.
REVOKE ALL ON FUNCTION public.approve_plan(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_plan(uuid, uuid, integer) TO authenticated, service_role;
--> statement-breakpoint

-- Keep plan-change requests SECURITY INVOKER: RLS still authorizes every write.
-- Only the now-private raw-plan read changes to the safe, authorized DTO.
CREATE OR REPLACE FUNCTION public.request_plan_change(
  p_order_id uuid,
  p_reason text,
  p_supplier_delta_kzt bigint,
  p_delivery_delta_kzt bigint
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders;
  v_plan record;
  v_thread uuid;
  v_id uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Требуется вход';
  END IF;
  IF char_length(v_reason) < 5 OR char_length(v_reason) > 2000 THEN
    RAISE EXCEPTION 'Опишите изменение: от 5 до 2000 символов';
  END IF;
  IF abs(coalesce(p_supplier_delta_kzt, 0)) > 100000000 OR abs(coalesce(p_delivery_delta_kzt, 0)) > 100000000 THEN
    RAISE EXCEPTION 'Сумма изменения указана некорректно';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Заказ не найден или недоступен';
  END IF;
  IF v_order.approved_plan_id IS NULL THEN
    RAISE EXCEPTION 'У заказа нет утверждённого плана';
  END IF;
  IF v_order.state NOT IN ('plan_approved', 'on_hold') THEN
    RAISE EXCEPTION 'Изменение условий доступно до выплаты поставщикам';
  END IF;

  SELECT * INTO v_plan
  FROM public.get_buyer_plans(ARRAY[v_order.request_id])
  WHERE id = v_order.approved_plan_id;
  IF NOT FOUND OR v_plan.status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'План уже изменён';
  END IF;

  BEGIN
    INSERT INTO public.change_requests (order_id, proposed_plan_id, initiator_user_id, diff, status)
    VALUES (
      p_order_id,
      v_plan.id,
      auth.uid(),
      jsonb_build_object(
        'reason', v_reason,
        'requestedSupplierDeltaKzt', coalesce(p_supplier_delta_kzt, 0),
        'requestedDeliveryDeltaKzt', coalesce(p_delivery_delta_kzt, 0),
        'expectedPlanId', v_plan.id,
        'expectedPlanVersion', v_plan.version
      ),
      'pending'
    )
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'По заказу уже есть запрос на рассмотрении';
  END;

  SELECT id INTO v_thread FROM public.threads WHERE order_id = p_order_id AND kind = 'buyer';
  IF v_thread IS NOT NULL THEN
    INSERT INTO public.messages (thread_id, author_user_id, body)
    VALUES (v_thread, auth.uid(), 'Запрос изменения условий: ' || v_reason);
  END IF;

  RETURN v_id;
END;
$$;
--> statement-breakpoint
-- Refresh PostgREST's function signatures after the return-type change.
NOTIFY pgrst, 'reload schema';
