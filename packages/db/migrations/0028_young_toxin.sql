CREATE TABLE "payment_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"supplier_company_id" uuid,
	"direction" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount_kzt" bigint NOT NULL,
	"reference" text,
	"proof_url" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_by" uuid,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_facts_amount_nonnegative" CHECK ("payment_facts"."amount_kzt" >= 0),
	CONSTRAINT "payment_facts_direction_valid" CHECK ("payment_facts"."direction" in ('inbound', 'outbound')),
	CONSTRAINT "payment_facts_kind_valid" CHECK ("payment_facts"."kind" in ('prepayment', 'surcharge', 'refund', 'supplier_payout')),
	CONSTRAINT "payment_facts_status_valid" CHECK ("payment_facts"."status" in ('pending', 'confirmed', 'void')),
	CONSTRAINT "payment_facts_kind_direction_valid" CHECK (("payment_facts"."direction" = 'inbound' and "payment_facts"."kind" in ('prepayment', 'surcharge')) or ("payment_facts"."direction" = 'outbound' and "payment_facts"."kind" in ('refund', 'supplier_payout')))
);
--> statement-breakpoint
ALTER TABLE "payment_facts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "supplier_rebate_kzt" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_facts" ADD CONSTRAINT "payment_facts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_facts" ADD CONSTRAINT "payment_facts_supplier_company_id_companies_id_fk" FOREIGN KEY ("supplier_company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_facts" ADD CONSTRAINT "payment_facts_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_facts_idempotency_key_idx" ON "payment_facts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "payment_facts_order_id_idx" ON "payment_facts" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payment_facts_status_idx" ON "payment_facts" USING btree ("status");--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_amounts_nonnegative" CHECK ("plans"."total_supplier_kzt" >= 0 and "plans"."delivery_kzt" >= 0 and "plans"."commission_kzt" >= 0 and "plans"."tax_effect_kzt" >= 0 and "plans"."supplier_rebate_kzt" >= 0 and "plans"."total_kzt" >= 0);--> statement-breakpoint
CREATE POLICY "payment_facts_select_staff" ON "payment_facts" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "payment_facts_select_buyer_own" ON "payment_facts" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("payment_facts"."direction" = 'inbound' and "payment_facts"."order_id" in (select o.id from "orders" o join "requests" r on r.id = o.request_id where r.buyer_company_id = (select public.current_company_id())));--> statement-breakpoint
CREATE POLICY "payment_facts_select_supplier_own" ON "payment_facts" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("payment_facts"."direction" = 'outbound' and "payment_facts"."supplier_company_id" = (select public.current_company_id()));--> statement-breakpoint
CREATE POLICY "payment_facts_insert_staff" ON "payment_facts" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "payment_facts_update_staff" ON "payment_facts" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_role()) in ('concierge', 'admin')) WITH CHECK ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "payment_facts_service_all" ON "payment_facts" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);
--> statement-breakpoint

ALTER TABLE public.payment_facts
  ADD CONSTRAINT payment_facts_amount_positive CHECK (amount_kzt > 0);
--> statement-breakpoint

-- A confirmed bank fact is an audited staff action, not a client-controlled
-- status flag. The idempotency key remains the stable retry boundary.
CREATE OR REPLACE FUNCTION public.guard_payment_fact() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF current_setting('role', true) IN ('authenticated', 'anon') THEN
    IF public.current_role() NOT IN ('concierge', 'admin') THEN
      RAISE EXCEPTION 'Платёжный факт может подтвердить только сотрудник QAJET';
    END IF;
    IF NEW.status = 'confirmed' AND (NEW.confirmed_by IS NULL OR NEW.confirmed_by IS DISTINCT FROM auth.uid()) THEN
      RAISE EXCEPTION 'Подтверждающий сотрудник не совпадает с текущей сессией';
    END IF;
    IF NEW.status = 'confirmed' AND nullif(trim(NEW.reference), '') IS NULL THEN
      RAISE EXCEPTION 'Для подтверждённого перевода нужен банковский reference';
    END IF;
    IF NEW.kind = 'supplier_payout' AND NEW.supplier_company_id IS NULL THEN
      RAISE EXCEPTION 'Для выплаты поставщику нужен поставщик';
    END IF;
    IF NEW.kind <> 'supplier_payout' AND NEW.supplier_company_id IS NOT NULL THEN
      RAISE EXCEPTION 'Поставщик не должен быть указан у входящего платежа покупателя';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payment_facts_guard
BEFORE INSERT OR UPDATE ON public.payment_facts
FOR EACH ROW EXECUTE FUNCTION public.guard_payment_fact();
--> statement-breakpoint

-- Plans and their lines are written in one RPC, so reconciliation is deferred
-- until all lines exist. It also protects direct PostgREST writes and commission
-- edits without rejecting the intermediate insert of a new proposed plan.
CREATE OR REPLACE FUNCTION public.guard_plan_reconciliation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_plan_id uuid;
  v_plan public.plans;
  v_supplier bigint;
  v_commission bigint;
  v_line_count integer;
BEGIN
  -- Trusted seed/service-role imports may stage an aggregate before its
  -- lines arrive. The authenticated database path is the one this guard
  -- protects; approval itself has a stricter aggregate contract below.
  IF current_setting('role', true) NOT IN ('authenticated', 'anon') THEN
    RETURN NULL;
  END IF;
  IF TG_TABLE_NAME = 'plans' THEN
    v_plan_id := NEW.id;
    v_plan := NEW;
  ELSE
    IF TG_OP = 'DELETE' THEN
      v_plan_id := OLD.plan_id;
    ELSE
      v_plan_id := NEW.plan_id;
    END IF;
    SELECT * INTO v_plan FROM public.plans WHERE id = v_plan_id;
  END IF;
  IF v_plan.id IS NULL OR v_plan.status = 'draft' THEN RETURN NULL; END IF;

  SELECT coalesce(sum(line_total_kzt), 0), coalesce(sum(commission_kzt), 0), count(*)
    INTO v_supplier, v_commission, v_line_count
  FROM public.plan_lines WHERE plan_id = v_plan.id;

  IF v_line_count = 0 OR v_supplier IS DISTINCT FROM v_plan.total_supplier_kzt
    OR v_commission IS DISTINCT FROM v_plan.commission_kzt
    OR v_plan.total_kzt IS DISTINCT FROM (v_plan.total_supplier_kzt + v_plan.delivery_kzt + v_plan.commission_kzt + v_plan.supplier_rebate_kzt) THEN
    RAISE EXCEPTION 'План не сходится: строки %, supplier %, комиссия %, итог %',
      v_line_count, v_supplier, v_commission, v_plan.total_kzt;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER plans_reconciliation_deferred
AFTER INSERT OR UPDATE OF total_supplier_kzt, delivery_kzt, commission_kzt, supplier_rebate_kzt, total_kzt, status ON public.plans
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.guard_plan_reconciliation();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER plan_lines_reconciliation_deferred
AFTER INSERT OR UPDATE OR DELETE ON public.plan_lines
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.guard_plan_reconciliation();
--> statement-breakpoint

-- Commission edits must update the line and the plan aggregate together. A
-- direct UPDATE of plan_lines would otherwise leave commission_kzt/total_kzt
-- stale and is rejected by the deferred reconciliation trigger.
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
  IF p_commission_pct < 21 OR p_commission_pct > 24 THEN
    RAISE EXCEPTION USING MESSAGE = 'Комиссия по позиции должна быть от 21% до 24%';
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
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.update_plan_line_commission(uuid, real) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_plan_line_commission(uuid, real) TO authenticated;
--> statement-breakpoint

-- Require independent payment evidence before a stage can claim that a
-- prepayment or supplier payout happened. Seed/service-role imports keep
-- working, while authenticated paths cannot manufacture paid rows.
CREATE OR REPLACE FUNCTION public.guard_paid_obligation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF current_setting('role', true) NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'prepayments' THEN
    IF NEW.status <> 'paid' THEN RETURN NEW; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.payment_facts pf
      JOIN public.orders o ON o.id = pf.order_id
      WHERE o.request_id = NEW.request_id
        AND pf.kind = 'prepayment' AND pf.status = 'confirmed'
        AND pf.amount_kzt > 0
        AND (SELECT coalesce(sum(pf2.amount_kzt), 0) FROM public.payment_facts pf2
             WHERE pf2.order_id = o.id AND pf2.kind = 'prepayment' AND pf2.status = 'confirmed') >= NEW.amount_kzt
    ) THEN
      RAISE EXCEPTION 'Статус paid требует подтверждённого банковского факта';
    END IF;
  ELSIF TG_TABLE_NAME = 'supplier_payouts' THEN
    IF NEW.status <> 'paid' THEN RETURN NEW; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.payment_facts pf
      WHERE pf.order_id = NEW.order_id
        AND pf.kind = 'supplier_payout' AND pf.status = 'confirmed'
        AND pf.supplier_company_id = NEW.supplier_company_id
        AND (SELECT coalesce(sum(pf2.amount_kzt), 0) FROM public.payment_facts pf2
             WHERE pf2.order_id = NEW.order_id
               AND pf2.kind = 'supplier_payout'
               AND pf2.status = 'confirmed'
               AND pf2.supplier_company_id = NEW.supplier_company_id) >= NEW.amount_kzt
    ) THEN
      RAISE EXCEPTION 'Статус paid требует подтверждённого банковского факта';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER prepayments_paid_guard
BEFORE INSERT OR UPDATE ON public.prepayments
FOR EACH ROW EXECUTE FUNCTION public.guard_paid_obligation();
--> statement-breakpoint
CREATE TRIGGER supplier_payouts_paid_guard
BEFORE INSERT OR UPDATE ON public.supplier_payouts
FOR EACH ROW EXECUTE FUNCTION public.guard_paid_obligation();
--> statement-breakpoint

-- Final settlement is derived from confirmed incoming/outgoing facts. The
-- buyer cannot replace this with an arbitrary amount in a request payload.
CREATE OR REPLACE FUNCTION public.guard_order_financial_facts() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_plan_total bigint;
  v_received bigint;
  v_refunded bigint;
  v_net bigint;
  v_expected_kind public.settlement;
  v_expected_amount bigint;
BEGIN
  IF current_setting('role', true) NOT IN ('authenticated', 'anon') OR NEW.state <> 'closed' OR OLD.state = 'closed' THEN
    RETURN NEW;
  END IF;
  SELECT total_kzt INTO v_plan_total FROM public.plans WHERE id = NEW.approved_plan_id;
  SELECT coalesce(sum(amount_kzt), 0) INTO v_received
    FROM public.payment_facts
    WHERE order_id = NEW.id AND direction = 'inbound' AND status = 'confirmed'
      AND kind IN ('prepayment', 'surcharge');
  SELECT coalesce(sum(amount_kzt), 0) INTO v_refunded
    FROM public.payment_facts
    WHERE order_id = NEW.id AND direction = 'outbound' AND status = 'confirmed' AND kind = 'refund';
  v_net := v_received - v_refunded;
  IF v_net > v_plan_total THEN
    v_expected_kind := 'refund'; v_expected_amount := v_net - v_plan_total;
  ELSIF v_net < v_plan_total THEN
    v_expected_kind := 'surcharge'; v_expected_amount := v_plan_total - v_net;
  ELSE
    v_expected_kind := 'exact'; v_expected_amount := 0;
  END IF;
  IF NEW.settlement IS DISTINCT FROM v_expected_kind
    OR abs(coalesce(NEW.settlement_amount_kzt, 0)) IS DISTINCT FROM v_expected_amount
    OR NEW.final_cost_kzt IS DISTINCT FROM v_plan_total THEN
    RAISE EXCEPTION 'Сверка не совпадает с подтверждёнными платежами';
  END IF;
  IF v_expected_kind = 'refund' AND (
    SELECT coalesce(sum(amount_kzt), 0) FROM public.payment_facts
    WHERE order_id = NEW.id AND kind = 'refund' AND status = 'confirmed'
  ) < v_expected_amount THEN
    RAISE EXCEPTION 'Возврат ещё не подтверждён';
  END IF;
  IF v_expected_kind = 'surcharge' AND (
    SELECT coalesce(sum(amount_kzt), 0) FROM public.payment_facts
    WHERE order_id = NEW.id AND kind = 'surcharge' AND status = 'confirmed'
  ) < v_expected_amount THEN
    RAISE EXCEPTION 'Доплата ещё не подтверждена';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER orders_guard_financial_facts
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_order_financial_facts();
--> statement-breakpoint

-- Approval binds the click to the plan the buyer actually reviewed. A stale
-- tab cannot silently approve a newer proposal.
DROP FUNCTION IF EXISTS public.approve_plan(uuid);
--> statement-breakpoint
CREATE FUNCTION public.approve_plan(
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
  IF NOT FOUND OR v_user.role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'Только покупатель может утвердить план';
  END IF;
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
  IF v_order.state NOT IN ('plan_proposed', 'awaiting_internal_approval') OR v_plan.status <> 'proposed' THEN
    RAISE EXCEPTION 'План больше не ожидает согласования';
  END IF;
  IF v_user.role = 'owner' AND v_user.approval_limit_kzt IS NOT NULL AND v_plan.total_kzt > v_user.approval_limit_kzt THEN
    RAISE EXCEPTION 'Сумма превышает лимит согласования владельца';
  END IF;
  v_next := CASE WHEN v_user.role = 'manager' AND v_plan.total_kzt > coalesce(v_user.approval_limit_kzt, 0)
    THEN 'awaiting_internal_approval'::public.order_state ELSE 'plan_approved'::public.order_state END;
  IF v_next = 'plan_approved' THEN
    UPDATE public.plans SET status = 'approved' WHERE id = v_plan.id RETURNING * INTO v_plan;
  END IF;
  UPDATE public.orders SET state = v_next WHERE id = v_order.id;
  INSERT INTO public.order_stage_events(order_id, from_state, to_state, actor_user_id, note)
    VALUES (v_order.id, v_order.state, v_next, v_user.id,
      format('Версия плана %s (%s): %s', v_plan.version, v_plan.id, v_next));
  RETURN v_plan;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.approve_plan(uuid, uuid, integer) FROM public, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.approve_plan(uuid, uuid, integer) TO authenticated;
--> statement-breakpoint

-- Atomic staff confirmation for the two obligations that unlock the
-- lifecycle. Replaying the same idempotency key returns the same outcome.
CREATE OR REPLACE FUNCTION public.confirm_prepayment(
  p_order_id uuid,
  p_amount_kzt bigint,
  p_reference text,
  p_occurred_at timestamptz,
  p_proof_url text,
  p_idempotency_key text
) RETURNS public.orders
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_order public.orders;
  v_prepayment public.prepayments;
  v_received bigint;
BEGIN
  IF public.current_role() NOT IN ('concierge', 'admin') OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Только сотрудник QAJET может подтвердить предоплату';
  END IF;
  IF p_amount_kzt <= 0 OR nullif(trim(p_reference), '') IS NULL OR nullif(trim(p_idempotency_key), '') IS NULL THEN
    RAISE EXCEPTION 'Сумма, банковский reference и idempotency key обязательны';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.state <> 'estimated' THEN
    IF v_order.state = 'prepaid' THEN RETURN v_order; END IF;
    RAISE EXCEPTION 'Предоплату можно подтвердить только на стадии оценки';
  END IF;
  SELECT * INTO v_prepayment FROM public.prepayments WHERE request_id = v_order.request_id FOR UPDATE;
  IF NOT FOUND OR v_prepayment.status <> 'issued' THEN
    RAISE EXCEPTION 'Сначала выставьте счёт на предоплату';
  END IF;

  INSERT INTO public.payment_facts(
    order_id, direction, kind, status, amount_kzt, reference, proof_url,
    occurred_at, confirmed_by, idempotency_key
  ) VALUES (
    v_order.id, 'inbound', 'prepayment', 'confirmed', p_amount_kzt,
    trim(p_reference), nullif(trim(p_proof_url), ''), coalesce(p_occurred_at, now()), auth.uid(),
    trim(p_idempotency_key)
  ) ON CONFLICT (idempotency_key) DO NOTHING;

  SELECT coalesce(sum(amount_kzt), 0) INTO v_received
  FROM public.payment_facts
  WHERE order_id = v_order.id AND direction = 'inbound' AND kind = 'prepayment' AND status = 'confirmed';
  IF v_received < v_prepayment.amount_kzt THEN
    RAISE EXCEPTION 'Сумма подтверждённых предоплат меньше суммы счёта';
  END IF;
  UPDATE public.prepayments
  SET status = 'paid', paid_at = now(), proof_url = coalesce(nullif(trim(p_proof_url), ''), proof_url), updated_at = now()
  WHERE id = v_prepayment.id;
  UPDATE public.orders SET state = 'prepaid', updated_at = now()
  WHERE id = v_order.id AND state = 'estimated' RETURNING * INTO v_order;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заказ уже изменён — обновите страницу'; END IF;
  RETURN v_order;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.confirm_prepayment(uuid, bigint, text, timestamptz, text, text) FROM public, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.confirm_prepayment(uuid, bigint, text, timestamptz, text, text) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.confirm_supplier_payout(
  p_order_id uuid,
  p_supplier_company_id uuid,
  p_amount_kzt bigint,
  p_reference text,
  p_occurred_at timestamptz,
  p_proof_url text,
  p_idempotency_key text
) RETURNS public.orders
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_order public.orders;
  v_expected bigint;
  v_confirmed bigint;
  v_supplier_count integer;
  v_paid_supplier_count integer;
BEGIN
  IF public.current_role() NOT IN ('concierge', 'admin') OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Только сотрудник QAJET может подтвердить выплату';
  END IF;
  IF p_amount_kzt <= 0 OR nullif(trim(p_reference), '') IS NULL OR nullif(trim(p_idempotency_key), '') IS NULL THEN
    RAISE EXCEPTION 'Сумма, банковский reference и idempotency key обязательны';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.state NOT IN ('plan_approved', 'on_hold') THEN
    RAISE EXCEPTION 'Выплату можно подтвердить только после утверждения плана';
  END IF;
  SELECT coalesce(sum(line_total_kzt), 0) INTO v_expected
  FROM public.plan_lines WHERE plan_id = v_order.approved_plan_id AND supplier_company_id = p_supplier_company_id;
  IF v_expected <= 0 THEN RAISE EXCEPTION 'Поставщик не участвует в утверждённом плане'; END IF;
  IF p_amount_kzt > v_expected THEN RAISE EXCEPTION 'Выплата не может превышать обязательство поставщика'; END IF;

  INSERT INTO public.payment_facts(
    order_id, supplier_company_id, direction, kind, status, amount_kzt, reference,
    proof_url, occurred_at, confirmed_by, idempotency_key
  ) VALUES (
    v_order.id, p_supplier_company_id, 'outbound', 'supplier_payout', 'confirmed', p_amount_kzt,
    trim(p_reference), nullif(trim(p_proof_url), ''), coalesce(p_occurred_at, now()), auth.uid(), trim(p_idempotency_key)
  ) ON CONFLICT (idempotency_key) DO NOTHING;

  SELECT coalesce(sum(amount_kzt), 0) INTO v_confirmed
  FROM public.payment_facts
  WHERE order_id = v_order.id AND supplier_company_id = p_supplier_company_id
    AND direction = 'outbound' AND kind = 'supplier_payout' AND status = 'confirmed';
  IF v_confirmed >= v_expected THEN
    INSERT INTO public.supplier_payouts(order_id, supplier_company_id, amount_kzt, status, paid_at)
      VALUES (v_order.id, p_supplier_company_id, v_expected, 'paid', now())
    ON CONFLICT (order_id, supplier_company_id) DO UPDATE SET
      amount_kzt = excluded.amount_kzt, status = 'paid', paid_at = excluded.paid_at, updated_at = now();
  END IF;

  SELECT count(*) INTO v_supplier_count FROM (
    SELECT supplier_company_id FROM public.plan_lines WHERE plan_id = v_order.approved_plan_id GROUP BY supplier_company_id
  ) s;
  SELECT count(*) INTO v_paid_supplier_count FROM public.supplier_payouts
  WHERE order_id = v_order.id AND status = 'paid';
  IF v_order.state = 'plan_approved' AND v_supplier_count > 0 AND v_supplier_count = v_paid_supplier_count THEN
    UPDATE public.orders SET state = 'suppliers_paid', updated_at = now()
    WHERE id = v_order.id AND state = 'plan_approved' RETURNING * INTO v_order;
  END IF;
  RETURN v_order;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.confirm_supplier_payout(uuid, uuid, bigint, text, timestamptz, text, text) FROM public, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.confirm_supplier_payout(uuid, uuid, bigint, text, timestamptz, text, text) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.confirm_settlement_payment(
  p_order_id uuid,
  p_direction text,
  p_kind text,
  p_amount_kzt bigint,
  p_reference text,
  p_occurred_at timestamptz,
  p_proof_url text,
  p_idempotency_key text
) RETURNS public.orders
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_order public.orders;
  v_plan_total bigint;
  v_received bigint;
  v_refunded bigint;
  v_net bigint;
  v_required bigint;
BEGIN
  IF public.current_role() NOT IN ('concierge', 'admin') OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Только сотрудник QAJET может подтвердить сверку';
  END IF;
  IF p_amount_kzt <= 0 OR nullif(trim(p_reference), '') IS NULL OR nullif(trim(p_idempotency_key), '') IS NULL THEN
    RAISE EXCEPTION 'Сумма, банковский reference и idempotency key обязательны';
  END IF;
  IF (p_direction, p_kind) NOT IN (('inbound', 'surcharge'), ('outbound', 'refund')) THEN
    RAISE EXCEPTION 'Недопустимый тип сверочного платежа';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.state <> 'accepted' THEN
    RAISE EXCEPTION 'Сверочный перевод доступен только после приёмки';
  END IF;
  SELECT total_kzt INTO v_plan_total FROM public.plans WHERE id = v_order.approved_plan_id;
  SELECT coalesce(sum(amount_kzt), 0) INTO v_received FROM public.payment_facts
    WHERE order_id = p_order_id AND direction = 'inbound' AND kind IN ('prepayment', 'surcharge') AND status = 'confirmed';
  SELECT coalesce(sum(amount_kzt), 0) INTO v_refunded FROM public.payment_facts
    WHERE order_id = p_order_id AND direction = 'outbound' AND kind = 'refund' AND status = 'confirmed';
  v_net := v_received - v_refunded;
  IF p_kind = 'surcharge' THEN
    IF v_net >= v_plan_total THEN RAISE EXCEPTION 'Доплата не требуется'; END IF;
    v_required := v_plan_total - v_net;
  ELSE
    IF v_net <= v_plan_total THEN RAISE EXCEPTION 'Возврат не требуется'; END IF;
    v_required := v_net - v_plan_total;
  END IF;
  IF p_amount_kzt > v_required THEN RAISE EXCEPTION 'Сумма превышает текущий остаток сверки'; END IF;
  INSERT INTO public.payment_facts(
    order_id, direction, kind, status, amount_kzt, reference, proof_url,
    occurred_at, confirmed_by, idempotency_key
  ) VALUES (
    p_order_id, p_direction, p_kind, 'confirmed', p_amount_kzt, trim(p_reference),
    nullif(trim(p_proof_url), ''), coalesce(p_occurred_at, now()), auth.uid(), trim(p_idempotency_key)
  ) ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN v_order;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.confirm_settlement_payment(uuid, text, text, bigint, text, timestamptz, text, text) FROM public, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.confirm_settlement_payment(uuid, text, text, bigint, text, timestamptz, text, text) TO authenticated;
