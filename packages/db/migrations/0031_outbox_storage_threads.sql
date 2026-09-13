-- Supabase Storage is private by design. The application authorizes access
-- through public.attachments under RLS before issuing a short-lived URL.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'qajet-docs',
  'qajet-docs',
  false,
  10485760,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
--> statement-breakpoint

-- Backfill the conversation invariant for records created before 0029.
INSERT INTO public.threads (request_id, kind)
SELECT r.id, kind
FROM public.requests r
CROSS JOIN (VALUES ('buyer'::public.thread_kind), ('internal'::public.thread_kind)) AS kinds(kind)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO public.threads (order_id, kind)
SELECT o.id, kind
FROM public.orders o
CROSS JOIN (VALUES ('buyer'::public.thread_kind), ('internal'::public.thread_kind)) AS kinds(kind)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO public.threads (order_id, kind, supplier_company_id)
SELECT o.id, 'supplier'::public.thread_kind, r.supplier_company_id
FROM public.rfqs r
JOIN public.orders o ON o.request_id = r.request_id
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO public.threads (order_id, kind, supplier_company_id)
SELECT o.id, 'supplier'::public.thread_kind, pl.supplier_company_id
FROM public.orders o
JOIN public.plan_lines pl ON pl.plan_id = o.approved_plan_id
ON CONFLICT DO NOTHING;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.ensure_plan_line_supplier_thread() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order_id uuid;
BEGIN
  SELECT id INTO v_order_id FROM public.orders WHERE approved_plan_id = NEW.plan_id LIMIT 1;
  IF v_order_id IS NOT NULL THEN
    INSERT INTO public.threads(order_id, kind, supplier_company_id)
      VALUES (v_order_id, 'supplier', NEW.supplier_company_id)
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS plan_lines_ensure_supplier_thread ON public.plan_lines;
CREATE TRIGGER plan_lines_ensure_supplier_thread
AFTER INSERT ON public.plan_lines
FOR EACH ROW EXECUTE FUNCTION public.ensure_plan_line_supplier_thread();
--> statement-breakpoint

-- Queue workers use these narrow functions instead of racing UPDATEs from
-- two Vercel invocations. Only the service role can claim or complete work.
CREATE OR REPLACE FUNCTION public.claim_outbox_batch(
  p_limit integer DEFAULT 20,
  p_lease_id text DEFAULT gen_random_uuid()::text
) RETURNS SETOF public.outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF current_setting('role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'Только worker service_role может забирать outbox';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT id
    FROM public.outbox
    WHERE (
      (status IN ('pending', 'failed') AND available_at <= now())
      OR (status = 'processing' AND leased_until < now())
    )
    ORDER BY available_at ASC, created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(coalesce(p_limit, 20), 100))
  )
  UPDATE public.outbox o
  SET status = 'processing',
      lease_id = p_lease_id,
      leased_until = now() + interval '5 minutes',
      attempts = o.attempts + 1,
      updated_at = now()
  FROM candidates
  WHERE o.id = candidates.id
  RETURNING o.*;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.claim_outbox_batch(integer, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_outbox_batch(integer, text) TO service_role;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.complete_outbox(
  p_id uuid,
  p_lease_id text,
  p_provider_message_id text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF current_setting('role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'Только worker service_role может завершить outbox';
  END IF;
  UPDATE public.outbox
  SET status = 'sent', lease_id = null, leased_until = null,
      provider_message_id = nullif(trim(p_provider_message_id), ''),
      sent_at = now(), delivered_at = now(), last_error = null, delivery_error = null, updated_at = now()
  WHERE id = p_id AND status = 'processing' AND lease_id = p_lease_id;
  RETURN FOUND;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.complete_outbox(uuid, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_outbox(uuid, text, text) TO service_role;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.fail_outbox(
  p_id uuid,
  p_lease_id text,
  p_error text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_attempts integer;
BEGIN
  IF current_setting('role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'Только worker service_role может вернуть outbox в retry';
  END IF;
  SELECT attempts INTO v_attempts FROM public.outbox
  WHERE id = p_id AND status = 'processing' AND lease_id = p_lease_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.outbox
  SET status = 'failed', lease_id = null, leased_until = null,
      last_error = left(coalesce(p_error, 'Неизвестная ошибка'), 2000),
      delivery_error = left(coalesce(p_error, 'Неизвестная ошибка'), 2000),
      available_at = now() + make_interval(secs => least(3600, greatest(30, 30 * power(2, least(v_attempts - 1, 6)))::integer)),
      updated_at = now()
  WHERE id = p_id;
  RETURN true;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.fail_outbox(uuid, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_outbox(uuid, text, text) TO service_role;
--> statement-breakpoint

-- A requested change creates a new, proposed immutable plan. The optional
-- supplier delta is applied to the first line deterministically and its
-- commission is recalculated from that new supplier cost; delivery is kept
-- outside the commission base. Paid/producing orders are deliberately
-- rejected here because changing their obligations needs an operational
-- exception flow, not a silent rewrite.
CREATE OR REPLACE FUNCTION public.resolve_plan_change(
  p_change_request_id uuid,
  p_expected_plan_id uuid,
  p_supplier_delta_kzt bigint DEFAULT 0,
  p_delivery_delta_kzt bigint DEFAULT 0
) RETURNS public.plans
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_change public.change_requests;
  v_order public.orders;
  v_old_plan public.plans;
  v_new_plan public.plans;
  v_line public.plan_lines;
  v_new_line_total bigint;
  v_new_supplier_total bigint;
  v_new_delivery bigint;
  v_commission bigint;
  v_commission_total bigint := 0;
  v_first boolean := true;
BEGIN
  IF public.current_role() NOT IN ('concierge', 'admin') OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Изменение плана подтверждает только сотрудник QAJET';
  END IF;
  SELECT * INTO v_change FROM public.change_requests
  WHERE id = p_change_request_id FOR UPDATE;
  IF NOT FOUND OR v_change.status <> 'pending' THEN
    RAISE EXCEPTION 'Запрос изменения уже обработан или не найден';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = v_change.order_id FOR UPDATE;
  IF NOT FOUND OR v_order.approved_plan_id IS DISTINCT FROM p_expected_plan_id THEN
    RAISE EXCEPTION 'Актуальный план уже изменён — обновите страницу';
  END IF;
  IF v_order.state NOT IN ('plan_approved', 'on_hold') THEN
    RAISE EXCEPTION 'Изменение условий доступно до выплаты поставщикам';
  END IF;
  SELECT * INTO v_old_plan FROM public.plans
  WHERE id = p_expected_plan_id AND request_id = (
    SELECT request_id FROM public.orders WHERE id = v_order.id
  ) FOR UPDATE;
  IF NOT FOUND OR v_old_plan.status <> 'approved' THEN
    RAISE EXCEPTION 'Утверждённый план не найден';
  END IF;
  IF p_supplier_delta_kzt < -v_old_plan.total_supplier_kzt
    OR v_old_plan.delivery_kzt + p_delivery_delta_kzt < 0 THEN
    RAISE EXCEPTION 'Изменение не может сделать обязательство отрицательным';
  END IF;
  v_new_supplier_total := v_old_plan.total_supplier_kzt + p_supplier_delta_kzt;
  v_new_delivery := v_old_plan.delivery_kzt + p_delivery_delta_kzt;

  INSERT INTO public.plans(
    request_id, version, kind, total_supplier_kzt, delivery_kzt, commission_kzt,
    commission_base, tax_effect_kzt, supplier_rebate_kzt, total_kzt, eta_date,
    slack_days, supplier_count, explanation, status
  ) VALUES (
    v_old_plan.request_id, v_old_plan.version + 1, 'manual', v_new_supplier_total,
    v_new_delivery, 0, v_old_plan.commission_base, v_old_plan.tax_effect_kzt,
    v_old_plan.supplier_rebate_kzt, 0, v_old_plan.eta_date, v_old_plan.slack_days,
    v_old_plan.supplier_count,
    jsonb_build_object(
      'method', 'approved_change_request',
      'changeRequestId', p_change_request_id,
      'supplierDeltaKzt', p_supplier_delta_kzt,
      'deliveryDeltaKzt', p_delivery_delta_kzt,
      'previousPlanId', v_old_plan.id
    ),
    'proposed'
  ) RETURNING * INTO v_new_plan;

  FOR v_line IN SELECT * FROM public.plan_lines
    WHERE plan_id = v_old_plan.id ORDER BY id FOR UPDATE LOOP
    v_new_line_total := v_line.line_total_kzt;
    IF v_first THEN
      v_new_line_total := v_new_line_total + p_supplier_delta_kzt;
      v_first := false;
    END IF;
    IF v_new_line_total < 0 THEN
      RAISE EXCEPTION 'Строка плана не может стать отрицательной';
    END IF;
    v_commission := round(v_new_line_total::numeric * v_line.commission_pct / 100)::bigint;
    v_commission_total := v_commission_total + v_commission;
    INSERT INTO public.plan_lines(
      plan_id, request_item_id, supplier_company_id, quote_line_id, qty,
      line_total_kzt, commission_pct, commission_kzt
    ) VALUES (
      v_new_plan.id, v_line.request_item_id, v_line.supplier_company_id,
      v_line.quote_line_id, v_line.qty, v_new_line_total, v_line.commission_pct,
      v_commission
    );
  END LOOP;
  IF v_first THEN RAISE EXCEPTION 'Нельзя версионировать план без строк'; END IF;

  UPDATE public.plans
  SET commission_kzt = v_commission_total,
      total_kzt = v_new_supplier_total + v_new_delivery + v_commission_total + v_old_plan.supplier_rebate_kzt,
      updated_at = now()
  WHERE id = v_new_plan.id
  RETURNING * INTO v_new_plan;
  UPDATE public.plans SET status = 'superseded', updated_at = now() WHERE id = v_old_plan.id;
  UPDATE public.orders
  SET approved_plan_id = v_new_plan.id,
      state = CASE WHEN v_order.state = 'plan_approved' THEN 'on_hold'::public.order_state ELSE v_order.state END,
      updated_at = now()
  WHERE id = v_order.id;
  UPDATE public.change_requests
  SET proposed_plan_id = v_new_plan.id,
      status = 'accepted',
      diff = diff || jsonb_build_object('appliedPlanId', v_new_plan.id, 'appliedAt', now()),
      updated_at = now()
  WHERE id = v_change.id;
  RETURN v_new_plan;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.resolve_plan_change(uuid, uuid, bigint, bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.resolve_plan_change(uuid, uuid, bigint, bigint) TO authenticated;
--> statement-breakpoint

-- Plan changes put the order on hold until a buyer approves the new version.
CREATE OR REPLACE FUNCTION public.enforce_order_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.state = NEW.state THEN RETURN NEW; END IF;
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

-- Same approval contract as 0028, with the additional on_hold branch used
-- by a reviewed plan revision.
CREATE OR REPLACE FUNCTION public.approve_plan(
  p_order_id uuid,
  p_expected_plan_id uuid,
  p_expected_plan_version integer
) RETURNS public.plans
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
  ) THEN RAISE EXCEPTION 'Только покупатель может утвердить план'; END IF;
  IF EXISTS (SELECT 1 FROM public.permissions WHERE user_id = v_user.id AND key = 'can_approve_plan' AND value <> 'true'::jsonb) THEN
    RAISE EXCEPTION 'Право утверждать планы отозвано';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.requests WHERE id = v_order.request_id AND buyer_company_id = v_user.company_id) THEN
    RAISE EXCEPTION 'Нет доступа к заказу';
  END IF;
  IF v_order.approved_plan_id IS DISTINCT FROM p_expected_plan_id THEN
    RAISE EXCEPTION 'План уже изменён — обновите страницу';
  END IF;
  SELECT * INTO v_plan FROM public.plans WHERE id = v_order.approved_plan_id AND request_id = v_order.request_id FOR UPDATE;
  IF NOT FOUND OR v_plan.version IS DISTINCT FROM p_expected_plan_version THEN
    RAISE EXCEPTION 'Версия плана уже изменена — обновите страницу';
  END IF;
  IF v_order.state = 'plan_approved' AND v_plan.status = 'approved' THEN RETURN v_plan; END IF;
  IF v_order.state NOT IN ('plan_proposed', 'awaiting_internal_approval', 'on_hold') OR v_plan.status <> 'proposed' THEN
    RAISE EXCEPTION 'План больше не ожидает согласования';
  END IF;
  IF v_user.role = 'owner' AND v_user.approval_limit_kzt IS NOT NULL AND v_plan.total_kzt > v_user.approval_limit_kzt THEN
    RAISE EXCEPTION 'Сумма превышает лимит согласования владельца';
  END IF;
  v_next := CASE WHEN v_user.role = 'manager' AND v_plan.total_kzt > coalesce(v_user.approval_limit_kzt, 0)
    THEN 'awaiting_internal_approval'::public.order_state ELSE 'plan_approved'::public.order_state END;
  IF v_next = 'plan_approved' THEN
    UPDATE public.plans SET status = 'approved', updated_at = now() WHERE id = v_plan.id RETURNING * INTO v_plan;
  END IF;
  UPDATE public.orders SET state = v_next, updated_at = now() WHERE id = v_order.id;
  INSERT INTO public.order_stage_events(order_id, from_state, to_state, actor_user_id, note)
    VALUES (v_order.id, v_order.state, v_next, v_user.id, format('Версия плана %s (%s): %s', v_plan.version, v_plan.id, v_next));
  RETURN v_plan;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.approve_plan(uuid, uuid, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.approve_plan(uuid, uuid, integer) TO authenticated;
