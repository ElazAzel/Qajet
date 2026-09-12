-- Supplier delivery confirmations, database-owned stage audit, and the final
-- actor/settlement invariants for the order lifecycle.
CREATE TABLE IF NOT EXISTS public.order_supplier_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  supplier_company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  confirmed_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_supplier_deliveries_order_supplier_unique UNIQUE (order_id, supplier_company_id)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS order_supplier_deliveries_order_id_idx
  ON public.order_supplier_deliveries(order_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS order_supplier_deliveries_supplier_company_id_idx
  ON public.order_supplier_deliveries(supplier_company_id);--> statement-breakpoint
ALTER TABLE public.order_supplier_deliveries ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS order_supplier_deliveries_select_own_supplier ON public.order_supplier_deliveries;--> statement-breakpoint
CREATE POLICY order_supplier_deliveries_select_own_supplier ON public.order_supplier_deliveries
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (supplier_company_id = public.current_company_id());--> statement-breakpoint
DROP POLICY IF EXISTS order_supplier_deliveries_select_staff ON public.order_supplier_deliveries;--> statement-breakpoint
CREATE POLICY order_supplier_deliveries_select_staff ON public.order_supplier_deliveries
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.current_role() IN ('concierge', 'admin'));--> statement-breakpoint
DROP POLICY IF EXISTS order_supplier_deliveries_insert_own_supplier ON public.order_supplier_deliveries;--> statement-breakpoint
CREATE POLICY order_supplier_deliveries_insert_own_supplier ON public.order_supplier_deliveries
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    public.order_supplier_deliveries.supplier_company_id = public.current_company_id()
    AND public.order_supplier_deliveries.confirmed_by = auth.uid()
    AND public.current_role() IN ('owner', 'manager')
    AND EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id = public.order_supplier_deliveries.supplier_company_id
        AND c.type = 'supplier' AND c.is_active
    )
    AND EXISTS (
      SELECT 1
      FROM public.orders o
      JOIN public.plan_lines pl ON pl.plan_id = o.approved_plan_id
      WHERE o.id = public.order_supplier_deliveries.order_id
        AND o.state = 'shipped'
        AND pl.supplier_company_id = public.order_supplier_deliveries.supplier_company_id
    )
  );--> statement-breakpoint
DROP POLICY IF EXISTS order_supplier_deliveries_service_all ON public.order_supplier_deliveries;--> statement-breakpoint
CREATE POLICY order_supplier_deliveries_service_all ON public.order_supplier_deliveries
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS supplier_payouts_order_supplier_idx
  ON public.supplier_payouts(order_id, supplier_company_id);--> statement-breakpoint

DROP POLICY IF EXISTS orders_update_supplier_delivery ON public.orders;--> statement-breakpoint
CREATE POLICY orders_update_supplier_delivery ON public.orders
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    state = 'shipped'
    AND EXISTS (
      SELECT 1 FROM public.plan_lines pl
      WHERE pl.plan_id = approved_plan_id
        AND pl.supplier_company_id = public.current_company_id()
    )
  )
  WITH CHECK (
    state IN ('shipped', 'delivered')
    AND EXISTS (
      SELECT 1 FROM public.plan_lines pl
      WHERE pl.plan_id = approved_plan_id
        AND pl.supplier_company_id = public.current_company_id()
    )
  );--> statement-breakpoint

-- Every state change writes its audit row in the same transaction as orders.
-- The authenticated client has no INSERT policy for this table anymore.
CREATE OR REPLACE FUNCTION public.audit_order_stage_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.state = NEW.state THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Переход заказа требует аутентифицированного автора';
  END IF;
  INSERT INTO public.order_stage_events(order_id, from_state, to_state, actor_user_id, note)
    VALUES (
      NEW.id,
      OLD.state,
      NEW.state,
      auth.uid(),
      format('Переход %s → %s', OLD.state, NEW.state)
    );
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS orders_audit_stage_transition ON public.orders;--> statement-breakpoint
CREATE TRIGGER orders_audit_stage_transition
  AFTER UPDATE OF state ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_order_stage_transition();--> statement-breakpoint
DROP POLICY IF EXISTS order_stage_events_insert_actor ON public.order_stage_events;--> statement-breakpoint

-- Replace the application-facing actor guard with the complete actor matrix.
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

  SELECT u.role, u.approval_limit_kzt
    INTO v_role, v_limit
  FROM public.users u
  WHERE u.id = auth.uid() AND u.is_active;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Профиль недоступен';
  END IF;

  v_buyer := v_role IN ('owner', 'manager') AND EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.companies c ON c.id = u.company_id
    JOIN public.requests r ON r.buyer_company_id = c.id
    WHERE u.id = auth.uid() AND c.type = 'buyer' AND c.is_active
      AND r.id = OLD.request_id
  );
  v_supplier := v_role IN ('owner', 'manager') AND EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.companies c ON c.id = u.company_id
    JOIN public.plan_lines pl ON pl.supplier_company_id = c.id
    WHERE u.id = auth.uid() AND c.type = 'supplier' AND c.is_active
      AND pl.plan_id = OLD.approved_plan_id
  );

  IF NEW.request_id IS DISTINCT FROM OLD.request_id THEN
    RAISE EXCEPTION 'Нельзя заменить заявку заказа';
  END IF;

  IF v_supplier AND (
    to_jsonb(NEW) - ARRAY['state', 'updated_at']
  ) IS DISTINCT FROM (
    to_jsonb(OLD) - ARRAY['state', 'updated_at']
  ) THEN
    RAISE EXCEPTION 'Поставщик может только подтвердить доставку';
  END IF;

  IF v_buyer AND (
    to_jsonb(NEW) - ARRAY['state', 'accepted_at', 'closed_at', 'settlement',
      'settlement_amount_kzt', 'final_cost_kzt', 'updated_at']
  ) IS DISTINCT FROM (
    to_jsonb(OLD) - ARRAY['state', 'accepted_at', 'closed_at', 'settlement',
      'settlement_amount_kzt', 'final_cost_kzt', 'updated_at']
  ) THEN
    RAISE EXCEPTION 'Покупатель не может менять внутренние поля заказа';
  END IF;

  IF OLD.state = NEW.state THEN
    IF v_buyer AND (
      to_jsonb(NEW) - 'updated_at'
    ) IS DISTINCT FROM (
      to_jsonb(OLD) - 'updated_at'
    ) THEN
      RAISE EXCEPTION 'Финансовые поля меняются только при завершении заказа';
    END IF;
    RETURN NEW;
  END IF;

  IF v_role IN ('concierge', 'admin') THEN
    IF NEW.state IN ('plan_approved', 'awaiting_internal_approval')
      OR (OLD.state = 'delivered' AND NEW.state = 'accepted')
      OR (OLD.state = 'shipped' AND NEW.state = 'delivered') THEN
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

  SELECT * INTO v_plan
  FROM public.plans
  WHERE id = NEW.approved_plan_id;

  IF NEW.state = 'plan_approved' THEN
    IF EXISTS (
      SELECT 1 FROM public.permissions
      WHERE user_id = auth.uid() AND key = 'can_approve_plan' AND value <> 'true'::jsonb
    ) THEN
      RAISE EXCEPTION 'Право утверждать планы отозвано';
    END IF;
    IF v_plan.status IS DISTINCT FROM 'approved'
      OR v_plan.request_id IS DISTINCT FROM NEW.request_id THEN
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
        SELECT 1
        FROM (SELECT DISTINCT supplier_company_id FROM public.plan_lines WHERE plan_id = v_plan.id) required
        WHERE NOT EXISTS (
          SELECT 1 FROM public.supplier_payouts sp
          WHERE sp.order_id = NEW.id
            AND sp.supplier_company_id = required.supplier_company_id
            AND sp.status = 'paid'
        )
      ) THEN
      RAISE EXCEPTION 'До исполнения нужны утверждённый план и подтверждённые выплаты поставщикам';
    END IF;
  END IF;

  IF NEW.state = 'delivered' AND (
    NOT EXISTS (
      SELECT 1 FROM public.order_supplier_deliveries d
      WHERE d.order_id = NEW.id AND d.supplier_company_id = public.current_company_id()
    )
    OR EXISTS (
      SELECT 1
      FROM (SELECT DISTINCT supplier_company_id FROM public.plan_lines WHERE plan_id = v_plan.id) required
      WHERE NOT EXISTS (
        SELECT 1 FROM public.order_supplier_deliveries d
        WHERE d.order_id = NEW.id AND d.supplier_company_id = required.supplier_company_id
      )
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

-- Keep the SQL graph in sync with the engine graph: disputed orders are not
-- silently put on hold, and delivery is still a legal edge for the actor guard.
CREATE OR REPLACE FUNCTION public.enforce_order_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.state = NEW.state THEN
    RETURN NEW;
  END IF;
  IF (OLD.state, NEW.state) IN (
    ('draft', 'estimated'),
    ('estimated', 'prepaid'),
    ('prepaid', 'rfq_sent'),
    ('rfq_sent', 'quotes_received'),
    ('rfq_sent', 'cancelled'),
    ('quotes_received', 'plan_proposed'),
    ('plan_proposed', 'plan_approved'),
    ('plan_proposed', 'awaiting_internal_approval'),
    ('plan_proposed', 'cancelled'),
    ('awaiting_internal_approval', 'plan_approved'),
    ('awaiting_internal_approval', 'cancelled'),
    ('plan_approved', 'suppliers_paid'),
    ('plan_approved', 'on_hold'),
    ('plan_approved', 'cancelled'),
    ('on_hold', 'suppliers_paid'),
    ('on_hold', 'cancelled'),
    ('suppliers_paid', 'in_production'),
    ('in_production', 'shipped'),
    ('shipped', 'delivered'),
    ('delivered', 'accepted'),
    ('delivered', 'disputed'),
    ('disputed', 'accepted'),
    ('accepted', 'closed')
  ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'order_state_transition: % -> % не определён в машине состояний', OLD.state, NEW.state
    USING ERRCODE = '23514';
END;
$$;--> statement-breakpoint

-- The atomic RPC uses the same orders trigger; the trigger is now the one
-- source of truth for the audit row.
CREATE OR REPLACE FUNCTION public.approve_plan(p_order_id uuid) RETURNS public.plans
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
  SELECT * INTO v_plan
  FROM public.plans
  WHERE id = v_order.approved_plan_id AND request_id = v_order.request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Актуальный план не найден';
  END IF;
  IF v_order.state = 'plan_approved' AND v_plan.status = 'approved' THEN
    RETURN v_plan;
  END IF;
  IF v_order.state NOT IN ('plan_proposed', 'awaiting_internal_approval') OR v_plan.status <> 'proposed' THEN
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
  IF v_next = v_order.state THEN
    RETURN v_plan;
  END IF;
  IF v_next = 'plan_approved' THEN
    UPDATE public.plans SET status = 'approved' WHERE id = v_plan.id RETURNING * INTO v_plan;
  END IF;
  UPDATE public.orders SET state = v_next WHERE id = v_order.id;
  RETURN v_plan;
END;
$$;--> statement-breakpoint
-- Confirming is deliberately an RPC: it inserts the supplier's confirmation
-- and advances the order only after every supplier in the approved plan has
-- confirmed. A repeated call is idempotent.
CREATE OR REPLACE FUNCTION public.confirm_supplier_delivery(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user public.users;
  v_order public.orders;
  v_supplier uuid;
  v_required integer;
  v_confirmed integer;
  v_delivered boolean := false;
BEGIN
  SELECT * INTO v_user
  FROM public.users
  WHERE id = auth.uid() AND is_active;
  IF NOT FOUND OR v_user.role NOT IN ('owner', 'manager') OR NOT EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.id = v_user.company_id AND c.type = 'supplier' AND c.is_active
  ) THEN
    RAISE EXCEPTION 'Только активный пользователь компании-поставщика может подтвердить доставку';
  END IF;
  v_supplier := v_user.company_id;

  SELECT * INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
    AND EXISTS (
      SELECT 1 FROM public.plan_lines pl
      WHERE pl.plan_id = o.approved_plan_id AND pl.supplier_company_id = v_supplier
    )
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Заказ не назначен вашей компании';
  END IF;
  IF v_order.state = 'delivered' THEN
    RETURN true;
  END IF;
  IF v_order.state <> 'shipped' THEN
    RAISE EXCEPTION 'Подтвердить доставку можно только для отправленного заказа';
  END IF;

  INSERT INTO public.order_supplier_deliveries(order_id, supplier_company_id, confirmed_by)
    VALUES (p_order_id, v_supplier, auth.uid())
  ON CONFLICT (order_id, supplier_company_id) DO NOTHING;

  SELECT count(*)::integer INTO v_required
  FROM (SELECT DISTINCT supplier_company_id FROM public.plan_lines WHERE plan_id = v_order.approved_plan_id) required;
  SELECT count(*)::integer INTO v_confirmed
  FROM public.order_supplier_deliveries d
  WHERE d.order_id = p_order_id;
  IF v_required > 0 AND v_confirmed >= v_required THEN
    UPDATE public.orders SET state = 'delivered' WHERE id = p_order_id AND state = 'shipped';
    v_delivered := true;
  END IF;
  RETURN v_delivered;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.confirm_supplier_delivery(uuid) FROM public, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.confirm_supplier_delivery(uuid) TO authenticated;

-- Public RFQ response: the URL carries a signed application token, while
-- these narrowly scoped functions bind every read/write to the opaque RFQ
-- nonce as a second, database-side check. No buyer or supplier directory
-- data is exposed by the public read function.
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
    AND c.type = 'supplier' AND c.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ссылка RFQ недействительна или уже закрыта';
  END IF;

  SELECT r.* INTO v_request FROM public.requests r WHERE r.id = v_rfq.request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Заявка RFQ не найдена';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object('id', i.id, 'name', i.name, 'qty', i.qty, 'unit', i.unit, 'category', i.category)
      ORDER BY i.created_at, i.id
    ),
    '[]'::jsonb
  ) INTO v_items
  FROM public.request_items i
  WHERE i.request_id = v_request.id;

  RETURN jsonb_build_object(
    'rfqId', v_rfq.id,
    'status', v_rfq.status,
    'respondBy', v_rfq.respond_by,
    'request', jsonb_build_object(
      'title', v_request.title,
      'deadlineDate', v_request.deadline_date
    ),
    'items', v_items
  );
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.get_rfq_quick_response(uuid,text) FROM public;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.get_rfq_quick_response(uuid,text) TO anon, authenticated;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.quick_respond_rfq_public(p_rfq_id uuid, p_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_status public.rfq_status;
BEGIN
  SELECT status INTO v_status
  FROM public.rfqs r
  JOIN public.companies c ON c.id = r.supplier_company_id
  WHERE r.id = p_rfq_id AND r.token = p_token
    AND c.type = 'supplier' AND c.is_active
  FOR UPDATE OF r;
  IF NOT FOUND OR v_status NOT IN ('sent', 'quick_responded') THEN
    RAISE EXCEPTION 'Ссылка RFQ недействительна или уже закрыта';
  END IF;
  IF v_status = 'sent' THEN
    UPDATE public.rfqs SET status = 'quick_responded' WHERE id = p_rfq_id;
  END IF;
  RETURN true;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.quick_respond_rfq_public(uuid,text) FROM public;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.quick_respond_rfq_public(uuid,text) TO anon, authenticated;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.decline_rfq_public(p_rfq_id uuid, p_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_status public.rfq_status;
BEGIN
  SELECT status INTO v_status
  FROM public.rfqs r
  JOIN public.companies c ON c.id = r.supplier_company_id
  WHERE r.id = p_rfq_id AND r.token = p_token
    AND c.type = 'supplier' AND c.is_active
  FOR UPDATE OF r;
  IF NOT FOUND OR v_status NOT IN ('sent', 'quick_responded') THEN
    RAISE EXCEPTION 'Ссылка RFQ недействительна или уже закрыта';
  END IF;
  UPDATE public.rfqs SET status = 'declined' WHERE id = p_rfq_id;
  RETURN true;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.decline_rfq_public(uuid,text) FROM public;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.decline_rfq_public(uuid,text) TO anon, authenticated;--> statement-breakpoint

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
BEGIN
  SELECT r.* INTO v_rfq
  FROM public.rfqs r
  JOIN public.companies c ON c.id = r.supplier_company_id
  WHERE r.id = p_rfq_id AND r.token = p_token
    AND r.status IN ('sent', 'quick_responded')
    AND c.type = 'supplier' AND c.is_active
  FOR UPDATE OF r;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ссылка RFQ недействительна или уже закрыта';
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
    FOR v_value IN SELECT value::text::numeric FROM jsonb_each(v_line)
      WHERE key IN ('unitPriceKzt', 'leadTimeDays', 'setupFeeKzt', 'minQty') AND value <> 'null'::jsonb LOOP
      IF v_value <> trunc(v_value) OR v_value < 0 OR v_value > 9007199254740991 THEN
        RAISE EXCEPTION 'Цена, срок и количество должны быть целыми неотрицательными числами';
      END IF;
    END LOOP;
    BEGIN
      v_item_id := (v_line->>'requestItemId')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Позиция КП указана некорректно';
    END;
    IF NOT EXISTS (
      SELECT 1 FROM public.request_items i
      WHERE i.id = v_item_id AND i.request_id = v_rfq.request_id
    ) THEN
      RAISE EXCEPTION 'Позиция не принадлежит этой заявке';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.quote_lines l
      WHERE l.quote_id = v_quote AND l.request_item_id = v_item_id
    ) THEN
      RAISE EXCEPTION 'Позиция уже добавлена в КП';
    END IF;
    v_min_qty := coalesce((v_line->>'minQty')::numeric, 1)::integer;
    v_setup_fee := coalesce((v_line->>'setupFeeKzt')::numeric, 0)::bigint;
    INSERT INTO public.quote_lines(
      quote_id, request_item_id, unit_price_kzt, lead_time_days,
      setup_fee_kzt, min_qty, capability_confirmed
    ) VALUES (
      v_quote, v_item_id, (v_line->>'unitPriceKzt')::numeric::bigint,
      (v_line->>'leadTimeDays')::numeric::integer, v_setup_fee, v_min_qty, true
    );
  END LOOP;
  UPDATE public.rfqs SET status = 'quoted' WHERE id = p_rfq_id;
  RETURN v_quote;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.submit_rfq_public(uuid,text,jsonb) FROM public;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.submit_rfq_public(uuid,text,jsonb) TO anon, authenticated;
