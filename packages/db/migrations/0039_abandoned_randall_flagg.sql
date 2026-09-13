ALTER TABLE "payment_facts" ADD CONSTRAINT "payment_facts_reference_valid" CHECK ("payment_facts"."status" = 'void' or length(trim(coalesce("payment_facts"."reference", ''))) between 1 and 200);
--> statement-breakpoint

-- Payment facts are an append-only audit trail. A correction is represented by
-- voiding the old fact and adding a new one; changing a confirmed amount or
-- reference in place would make reconciliation non-repeatable.
CREATE OR REPLACE FUNCTION public.guard_payment_fact_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF current_setting('role', true) NOT IN ('authenticated', 'anon') THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' AND OLD.status = 'confirmed' THEN
    RAISE EXCEPTION 'Подтверждённый платёжный факт нельзя удалить; сначала аннулируйте его';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'confirmed' THEN
    IF NEW.order_id IS DISTINCT FROM OLD.order_id
      OR NEW.supplier_company_id IS DISTINCT FROM OLD.supplier_company_id
      OR NEW.direction IS DISTINCT FROM OLD.direction
      OR NEW.kind IS DISTINCT FROM OLD.kind
      OR NEW.amount_kzt IS DISTINCT FROM OLD.amount_kzt
      OR NEW.reference IS DISTINCT FROM OLD.reference
      OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
      OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
      RAISE EXCEPTION 'Подтверждённый платёжный факт нельзя редактировать';
    END IF;
    IF NEW.status NOT IN ('confirmed', 'void') THEN
      RAISE EXCEPTION 'Подтверждённый платёж можно только аннулировать';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS payment_facts_immutability_guard ON public.payment_facts;
CREATE TRIGGER payment_facts_immutability_guard
BEFORE UPDATE OR DELETE ON public.payment_facts
FOR EACH ROW EXECUTE FUNCTION public.guard_payment_fact_immutability();
--> statement-breakpoint

-- Partial supplier payouts are supported, but the sum of all confirmed facts
-- must never exceed the saved obligation for that supplier in the approved
-- plan. This protects both the RPC and direct authenticated PostgREST writes.
CREATE OR REPLACE FUNCTION public.guard_supplier_payout_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_plan_id uuid;
  v_expected bigint;
  v_confirmed bigint;
BEGIN
  IF current_setting('role', true) NOT IN ('authenticated', 'anon')
    OR NEW.kind <> 'supplier_payout'
    OR NEW.status <> 'confirmed' THEN
    RETURN NEW;
  END IF;
  IF NEW.supplier_company_id IS NULL THEN
    RAISE EXCEPTION 'Для выплаты поставщику нужен поставщик';
  END IF;
  SELECT approved_plan_id INTO v_plan_id
  FROM public.orders
  WHERE id = NEW.order_id;
  SELECT coalesce(sum(pl.line_total_kzt), 0) INTO v_expected
  FROM public.plan_lines pl
  WHERE pl.plan_id = v_plan_id AND pl.supplier_company_id = NEW.supplier_company_id;
  IF v_expected <= 0 THEN
    RAISE EXCEPTION 'Поставщик не участвует в утверждённом плане';
  END IF;
  SELECT coalesce(sum(pf.amount_kzt), 0) INTO v_confirmed
  FROM public.payment_facts pf
  WHERE pf.order_id = NEW.order_id
    AND pf.supplier_company_id = NEW.supplier_company_id
    AND pf.direction = 'outbound'
    AND pf.kind = 'supplier_payout'
    AND pf.status = 'confirmed'
    AND pf.id IS DISTINCT FROM NEW.id;
  IF v_confirmed + NEW.amount_kzt > v_expected THEN
    RAISE EXCEPTION 'Сумма выплат превышает обязательство поставщика';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS payment_facts_supplier_payout_total ON public.payment_facts;
CREATE TRIGGER payment_facts_supplier_payout_total
BEFORE INSERT OR UPDATE OF amount_kzt, order_id, supplier_company_id, kind, status ON public.payment_facts
FOR EACH ROW EXECUTE FUNCTION public.guard_supplier_payout_total();
--> statement-breakpoint

-- A revision request is a transactional domain event: the supplier flag and
-- the notification must be committed together. The idempotency key is scoped
-- to the next quote version, so a later correction can notify again without
-- duplicating retries for the same revision request.
CREATE OR REPLACE FUNCTION public.request_supplier_quote_revision(
  p_rfq_id uuid,
  p_note text
) RETURNS public.rfqs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_rfq public.rfqs;
  v_note text := nullif(trim(p_note), '');
  v_next_version integer;
BEGIN
  IF auth.uid() IS NULL OR public.current_role() NOT IN ('concierge', 'admin') THEN
    RAISE EXCEPTION 'Запросить исправление КП может только сотрудник QAJET';
  END IF;
  IF v_note IS NULL OR length(v_note) < 5 OR length(v_note) > 2000 THEN
    RAISE EXCEPTION 'Причина исправления должна быть от 5 до 2000 символов';
  END IF;
  SELECT * INTO v_rfq FROM public.rfqs WHERE id = p_rfq_id FOR UPDATE;
  IF NOT FOUND OR v_rfq.status <> 'quoted' THEN
    RAISE EXCEPTION 'Исправление доступно только для уже отправленного КП';
  END IF;
  SELECT coalesce(max(version), 0) + 1 INTO v_next_version
  FROM public.quotes
  WHERE rfq_id = p_rfq_id;
  UPDATE public.rfqs
  SET revision_requested = true, revision_note = v_note, updated_at = now()
  WHERE id = p_rfq_id
  RETURNING * INTO v_rfq;

  INSERT INTO public.outbox(
    channel, kind, recipient, subject, body, payload, status, attempts, idempotency_key
  )
  SELECT
    'email',
    'rfq_revision_requested',
    u.email,
    'QAJET: требуется исправить КП',
    format(
      'Нужно исправить КП по RFQ %s: %s. Откройте рабочий кабинет поставщика.',
      p_rfq_id,
      v_note
    ),
    jsonb_build_object(
      'rfqId', p_rfq_id,
      'note', v_note,
      'quoteVersion', v_next_version
    ),
    'pending',
    0,
    format('rfq-revision:%s:%s:%s', p_rfq_id, v_next_version, u.id)
  FROM public.users u
  WHERE u.company_id = v_rfq.supplier_company_id
    AND u.is_active
    AND u.role IN ('owner', 'manager')
    AND (v_rfq.assigned_supplier_user_id IS NULL OR u.id = v_rfq.assigned_supplier_user_id)
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN v_rfq;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.request_supplier_quote_revision(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.request_supplier_quote_revision(uuid, text) TO authenticated;
--> statement-breakpoint

-- A quote line must carry an explicit capability decision. Older callers that
-- omit it remain importable for audit purposes, but the line is stored as
-- unconfirmed and is rejected by the combiner instead of being guessed true.
CREATE OR REPLACE FUNCTION public.submit_supplier_quote(p_rfq_id uuid, p_lines jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rfq public.rfqs;
  v_previous public.quotes;
  v_quote uuid;
  v_line jsonb;
  v_item_id uuid;
  v_key text;
  v_value numeric;
  v_min_qty integer;
  v_setup_fee bigint;
  v_capability_confirmed boolean;
  v_field_flags jsonb;
  v_version integer;
  v_is_revision boolean;
BEGIN
  IF auth.uid() IS NULL OR public.current_company_id() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.companies c ON c.id = u.company_id
    WHERE u.id = auth.uid() AND u.is_active AND u.role IN ('owner', 'manager')
      AND u.company_id = public.current_company_id()
      AND c.type = 'supplier' AND c.is_active
  ) THEN
    RAISE EXCEPTION 'Только активный поставщик может ответить на RFQ';
  END IF;
  SELECT * INTO v_rfq
  FROM public.rfqs
  WHERE id = p_rfq_id
    AND supplier_company_id = public.current_company_id()
    AND (
      status IN ('sent', 'quick_responded')
      OR (status = 'quoted' AND revision_requested)
    )
    AND (respond_by IS NULL OR respond_by > now() OR revision_requested)
    AND (
      public.current_role() = 'owner'
      OR assigned_supplier_user_id IS NULL
      OR assigned_supplier_user_id = auth.uid()
    )
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RFQ недоступен, просрочен или уже закрыт'; END IF;
  v_is_revision := v_rfq.status = 'quoted' AND v_rfq.revision_requested;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Укажите хотя бы одну позицию КП';
  END IF;

  SELECT * INTO v_previous FROM public.quotes
  WHERE rfq_id = p_rfq_id
  ORDER BY version DESC, submitted_at DESC, id DESC
  LIMIT 1;
  v_version := coalesce(v_previous.version, 0) + 1;
  INSERT INTO public.quotes(
    rfq_id, version, supersedes_quote_id, submitted_by, revision_reason, source
  ) VALUES (
    p_rfq_id, v_version, v_previous.id, auth.uid(),
    CASE WHEN v_is_revision THEN v_rfq.revision_note ELSE NULL END, 'form'
  ) RETURNING id INTO v_quote;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    IF jsonb_typeof(v_line) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Каждая строка КП должна быть объектом';
    END IF;
    IF jsonb_typeof(v_line->'unitPriceKzt') IS DISTINCT FROM 'number'
      OR jsonb_typeof(v_line->'leadTimeDays') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Цена и срок должны быть числами';
    END IF;
    FOR v_key, v_value IN SELECT key, value::text::numeric FROM jsonb_each(v_line)
      WHERE key IN ('unitPriceKzt', 'leadTimeDays', 'setupFeeKzt', 'minQty') AND value <> 'null'::jsonb LOOP
      IF v_value <> trunc(v_value) OR v_value < 0 OR v_value > 9007199254740991
        OR (v_key IN ('leadTimeDays', 'minQty') AND v_value > 2147483647) THEN
        RAISE EXCEPTION 'Цена, срок и количество должны быть целыми неотрицательными числами';
      END IF;
    END LOOP;
    IF (v_line->>'unitPriceKzt')::numeric <= 0
      OR (v_line->>'leadTimeDays')::numeric <= 0
      OR (v_line ? 'minQty' AND v_line->'minQty' <> 'null'::jsonb AND (v_line->>'minQty')::numeric <= 0) THEN
      RAISE EXCEPTION 'Цена, срок и минимальная партия должны быть больше нуля';
    END IF;
    IF nullif(v_line->>'requestItemId', '') IS NULL THEN
      RAISE EXCEPTION 'Укажите позицию заявки для каждой строки КП';
    END IF;
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
    IF jsonb_typeof(v_line->'capabilityConfirmed') IS DISTINCT FROM 'boolean' THEN
      v_capability_confirmed := false;
      v_field_flags := v_field_flags || jsonb_build_object('capabilityConfirmed', 'missing');
    ELSE
      v_capability_confirmed := (v_line->>'capabilityConfirmed')::boolean;
      IF NOT v_capability_confirmed THEN
        v_field_flags := v_field_flags || jsonb_build_object('capabilityConfirmed', 'not_confirmed');
      END IF;
    END IF;
    INSERT INTO public.quote_lines(
      quote_id, request_item_id, unit_price_kzt, lead_time_days,
      setup_fee_kzt, min_qty, capability_confirmed, field_flags
    ) VALUES (
      v_quote, v_item_id, (v_line->>'unitPriceKzt')::numeric::bigint,
      (v_line->>'leadTimeDays')::numeric::integer,
      coalesce(v_setup_fee, 0), v_min_qty, v_capability_confirmed, v_field_flags
    );
  END LOOP;
  UPDATE public.rfqs
  SET status = 'quoted', revision_requested = false, revision_note = null, updated_at = now()
  WHERE id = p_rfq_id;
  RETURN v_quote;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.submit_supplier_quote(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.submit_supplier_quote(uuid, jsonb) TO authenticated;
--> statement-breakpoint

-- The anonymous signed-link path has the same numeric and capability contract
-- as the authenticated supplier path. It cannot call the authenticated RPC,
-- so the transaction is kept explicit here.
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
  v_key text;
  v_value numeric;
  v_min_qty integer;
  v_setup_fee bigint;
  v_capability_confirmed boolean;
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
    FOR v_key, v_value IN SELECT key, value::text::numeric FROM jsonb_each(v_line)
      WHERE key IN ('unitPriceKzt', 'leadTimeDays', 'setupFeeKzt', 'minQty') AND value <> 'null'::jsonb LOOP
      IF v_value <> trunc(v_value) OR v_value < 0 OR v_value > 9007199254740991
        OR (v_key IN ('leadTimeDays', 'minQty') AND v_value > 2147483647) THEN
        RAISE EXCEPTION 'Цена, срок и количество должны быть целыми неотрицательными числами';
      END IF;
    END LOOP;
    IF (v_line->>'unitPriceKzt')::numeric <= 0
      OR (v_line->>'leadTimeDays')::numeric <= 0
      OR (v_line ? 'minQty' AND v_line->'minQty' <> 'null'::jsonb AND (v_line->>'minQty')::numeric <= 0) THEN
      RAISE EXCEPTION 'Цена, срок и минимальная партия должны быть больше нуля';
    END IF;
    IF nullif(v_line->>'requestItemId', '') IS NULL THEN
      RAISE EXCEPTION 'Укажите позицию заявки для каждой строки КП';
    END IF;
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
    IF jsonb_typeof(v_line->'capabilityConfirmed') IS DISTINCT FROM 'boolean' THEN
      v_capability_confirmed := false;
      v_field_flags := v_field_flags || jsonb_build_object('capabilityConfirmed', 'missing');
    ELSE
      v_capability_confirmed := (v_line->>'capabilityConfirmed')::boolean;
      IF NOT v_capability_confirmed THEN
        v_field_flags := v_field_flags || jsonb_build_object('capabilityConfirmed', 'not_confirmed');
      END IF;
    END IF;
    INSERT INTO public.quote_lines(
      quote_id, request_item_id, unit_price_kzt, lead_time_days,
      setup_fee_kzt, min_qty, capability_confirmed, field_flags
    ) VALUES (
      v_quote, v_item_id, (v_line->>'unitPriceKzt')::numeric::bigint,
      (v_line->>'leadTimeDays')::numeric::integer,
      coalesce(v_setup_fee, 0), v_min_qty, v_capability_confirmed, v_field_flags
    );
  END LOOP;
  UPDATE public.rfqs SET status = 'quoted' WHERE id = p_rfq_id;
  RETURN v_quote;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.submit_rfq_public(uuid, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_rfq_public(uuid, text, jsonb) TO anon, authenticated;
--> statement-breakpoint

-- A bank transfer is a fact, not a toggle: one invoice may be settled by
-- several confirmed transfers. Partial payment keeps the order in `estimated`
-- and a later transfer may finish the invoice without creating a duplicate
-- prepayment or bypassing the payment-fact audit trail.
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
  v_existing public.payment_facts;
  v_prepayment public.prepayments;
  v_received bigint;
BEGIN
  IF public.current_role() NOT IN ('concierge', 'admin') OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Только сотрудник QAJET может подтвердить предоплату';
  END IF;
  IF p_amount_kzt <= 0
    OR nullif(trim(p_reference), '') IS NULL
    OR nullif(trim(p_idempotency_key), '') IS NULL THEN
    RAISE EXCEPTION 'Сумма, банковский reference и idempotency key обязательны';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заказ не найден'; END IF;

  SELECT * INTO v_existing
  FROM public.payment_facts
  WHERE idempotency_key = trim(p_idempotency_key)
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.order_id IS DISTINCT FROM p_order_id
      OR v_existing.direction IS DISTINCT FROM 'inbound'
      OR v_existing.kind IS DISTINCT FROM 'prepayment'
      OR v_existing.amount_kzt IS DISTINCT FROM p_amount_kzt
      OR v_existing.reference IS DISTINCT FROM trim(p_reference)
      OR v_existing.status IS DISTINCT FROM 'confirmed' THEN
      RAISE EXCEPTION 'Idempotency key уже используется для другого платежа';
    END IF;
    RETURN v_order;
  END IF;
  IF v_order.state NOT IN ('estimated', 'prepaid') THEN
    RAISE EXCEPTION 'Предоплату можно подтвердить только после оценки заказа';
  END IF;

  SELECT * INTO v_prepayment
  FROM public.prepayments
  WHERE request_id = v_order.request_id
  FOR UPDATE;
  IF NOT FOUND OR v_prepayment.status NOT IN ('issued', 'paid') THEN
    RAISE EXCEPTION 'Сначала выставьте счёт на предоплату';
  END IF;

  INSERT INTO public.payment_facts(
    order_id, direction, kind, status, amount_kzt, reference, proof_url,
    occurred_at, confirmed_by, idempotency_key
  ) VALUES (
    v_order.id, 'inbound', 'prepayment', 'confirmed', p_amount_kzt,
    trim(p_reference), nullif(trim(p_proof_url), ''), coalesce(p_occurred_at, now()), auth.uid(),
    trim(p_idempotency_key)
  );

  SELECT coalesce(sum(amount_kzt), 0) INTO v_received
  FROM public.payment_facts
  WHERE order_id = v_order.id
    AND direction = 'inbound'
    AND kind = 'prepayment'
    AND status = 'confirmed';

  IF v_received >= v_prepayment.amount_kzt THEN
    UPDATE public.prepayments
    SET status = 'paid',
        paid_at = coalesce(paid_at, now()),
        proof_url = coalesce(nullif(trim(p_proof_url), ''), proof_url),
        updated_at = now()
    WHERE id = v_prepayment.id;
    UPDATE public.orders
    SET state = CASE WHEN state = 'estimated' THEN 'prepaid'::public.order_state ELSE state END,
        updated_at = now()
    WHERE id = v_order.id
    RETURNING * INTO v_order;
  ELSE
    UPDATE public.prepayments
    SET proof_url = coalesce(nullif(trim(p_proof_url), ''), proof_url), updated_at = now()
    WHERE id = v_prepayment.id;
  END IF;
  RETURN v_order;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.confirm_prepayment(uuid, bigint, text, timestamptz, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.confirm_prepayment(uuid, bigint, text, timestamptz, text, text) TO authenticated;
--> statement-breakpoint

-- Keep plan arithmetic authoritative at the database boundary as well. The
-- application engine prepares the values, but an authenticated PostgREST
-- caller must not be able to approve a plan whose lines, commission, or
-- supplier links do not reconcile.
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
  IF NEW.line_total_kzt < 0 OR NEW.commission_pct = 'NaN'::real
    OR NEW.commission_pct < 21 OR NEW.commission_pct > 24 THEN
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
--> statement-breakpoint
DROP TRIGGER IF EXISTS plan_lines_contract_guard ON public.plan_lines;
CREATE TRIGGER plan_lines_contract_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.plan_lines
FOR EACH ROW EXECUTE FUNCTION public.guard_plan_line_contract();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.guard_plan_aggregate_contract() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_line_count integer;
  v_supplier_count integer;
  v_supplier_total bigint;
  v_commission_total bigint;
BEGIN
  IF current_setting('role', true) NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF NEW.status <> 'approved' OR (TG_OP = 'UPDATE' AND OLD.status = 'approved') THEN
    RETURN NEW;
  END IF;
  SELECT count(*), count(DISTINCT supplier_company_id),
    coalesce(sum(line_total_kzt), 0), coalesce(sum(commission_kzt), 0)
  INTO v_line_count, v_supplier_count, v_supplier_total, v_commission_total
  FROM public.plan_lines
  WHERE plan_id = NEW.id;
  IF v_line_count = 0
    OR NEW.total_supplier_kzt IS DISTINCT FROM v_supplier_total
    OR NEW.commission_kzt IS DISTINCT FROM v_commission_total
    OR NEW.supplier_count IS DISTINCT FROM v_supplier_count
    OR NEW.total_kzt IS DISTINCT FROM (
      NEW.total_supplier_kzt + NEW.delivery_kzt + NEW.commission_kzt + NEW.supplier_rebate_kzt
    ) THEN
    RAISE EXCEPTION 'Итоги плана не сходятся со строками';
  END IF;
  IF NEW.commission_base IS DISTINCT FROM 'supplier_ex_delivery' THEN
    RAISE EXCEPTION 'Недопустимая база комиссии плана';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS plans_aggregate_contract_guard ON public.plans;
CREATE TRIGGER plans_aggregate_contract_guard
BEFORE INSERT OR UPDATE OF status ON public.plans
FOR EACH ROW EXECUTE FUNCTION public.guard_plan_aggregate_contract();
--> statement-breakpoint

-- Keep the legacy commission aggregate trigger consistent with the explicit
-- supplier-rebate disclosure field. Rebate is visible separately to the
-- buyer, but it is still part of the amount QAJET invoices and reconciles.
CREATE OR REPLACE FUNCTION public.aggregate_plan_commission() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_commission bigint;
BEGIN
  SELECT coalesce(sum(commission_kzt), 0) INTO v_commission
  FROM public.plan_lines WHERE plan_id = NEW.plan_id;
  UPDATE public.plans
  SET commission_kzt = v_commission,
      total_kzt = total_supplier_kzt + delivery_kzt + v_commission + supplier_rebate_kzt
  WHERE id = NEW.plan_id;
  RETURN NEW;
END;
$$;

--> statement-breakpoint

-- The bucket is private, including in local Supabase. When the service-role
-- key is intentionally absent, uploads and short-lived downloads use the
-- authenticated server client, so Storage itself must enforce the same
-- ownership boundary as public.attachments. Object keys are rooted at the
-- uploader's user id (see createAttachmentObjectKey()).
DROP POLICY IF EXISTS qajet_docs_objects_insert ON storage.objects;
CREATE POLICY qajet_docs_objects_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'qajet-docs'
  AND (storage.foldername(name))[1] = (select auth.uid()::text)
);
--> statement-breakpoint
DROP POLICY IF EXISTS qajet_docs_objects_select ON storage.objects;
CREATE POLICY qajet_docs_objects_select ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'qajet-docs'
  AND (
    (storage.foldername(name))[1] = (select auth.uid()::text)
    OR EXISTS (
      SELECT 1
      FROM public.attachments a
      WHERE a.object_key = storage.objects.name
    )
  )
);
--> statement-breakpoint
DROP POLICY IF EXISTS qajet_docs_objects_delete ON storage.objects;
CREATE POLICY qajet_docs_objects_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'qajet-docs'
  AND (
    (storage.foldername(name))[1] = (select auth.uid()::text)
    OR EXISTS (
      SELECT 1
      FROM public.attachments a
      WHERE a.object_key = storage.objects.name
        AND a.uploaded_by = (select auth.uid())
    )
  )
);
--> statement-breakpoint

-- A summary row must describe the whole supplier obligation. Without this
-- guard an authenticated caller could write a smaller `paid` row and let the
-- stage transition see a paid supplier while the payment facts described a
-- different amount.
CREATE OR REPLACE FUNCTION public.guard_supplier_payout_summary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_expected bigint;
BEGIN
  IF current_setting('role', true) NOT IN ('authenticated', 'anon') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'paid' THEN
      RAISE EXCEPTION 'Подтверждённую выплату поставщику нельзя удалить';
    END IF;
    RETURN OLD;
  END IF;
  SELECT coalesce(sum(pl.line_total_kzt), 0)
  INTO v_expected
  FROM public.orders o
  JOIN public.plan_lines pl ON pl.plan_id = o.approved_plan_id
  WHERE o.id = NEW.order_id
    AND pl.supplier_company_id = NEW.supplier_company_id;
  IF v_expected <= 0 OR NEW.amount_kzt IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'Выплата должна равняться обязательству поставщика по плану';
  END IF;
  IF NEW.status = 'paid' AND NEW.paid_at IS NULL THEN
    RAISE EXCEPTION 'У подтверждённой выплаты должна быть дата оплаты';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'paid' AND (
    NEW.order_id IS DISTINCT FROM OLD.order_id OR
    NEW.supplier_company_id IS DISTINCT FROM OLD.supplier_company_id OR
    NEW.amount_kzt IS DISTINCT FROM OLD.amount_kzt OR
    NEW.status IS DISTINCT FROM OLD.status
  ) THEN
    RAISE EXCEPTION 'Подтверждённую выплату нельзя редактировать';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS supplier_payouts_summary_guard ON public.supplier_payouts;
CREATE TRIGGER supplier_payouts_summary_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.supplier_payouts
FOR EACH ROW EXECUTE FUNCTION public.guard_supplier_payout_summary();
--> statement-breakpoint

-- `prepaid` is a financial claim, not a freely writable order state. The
-- transition remains valid for a partial-payment retry only after the
-- confirmed inbound facts cover the issued invoice in full.
CREATE OR REPLACE FUNCTION public.guard_prepaid_payment_contract()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invoice_amount bigint;
  v_received bigint;
BEGIN
  IF current_setting('role', true) NOT IN ('authenticated', 'anon')
    OR NEW.state <> 'prepaid'
    OR OLD.state = 'prepaid' THEN
    RETURN NEW;
  END IF;
  SELECT amount_kzt INTO v_invoice_amount
  FROM public.prepayments
  WHERE request_id = NEW.request_id AND status = 'paid'
  ORDER BY paid_at DESC NULLS LAST, updated_at DESC
  LIMIT 1;
  SELECT coalesce(sum(pf.amount_kzt), 0) INTO v_received
  FROM public.payment_facts pf
  WHERE pf.order_id = NEW.id
    AND pf.direction = 'inbound'
    AND pf.kind = 'prepayment'
    AND pf.status = 'confirmed';
  IF v_invoice_amount IS NULL OR v_received < v_invoice_amount THEN
    RAISE EXCEPTION 'Стадия prepaid требует полностью подтверждённую предоплату';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS orders_prepaid_payment_guard ON public.orders;
CREATE TRIGGER orders_prepaid_payment_guard
BEFORE UPDATE OF state ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_prepaid_payment_contract();
--> statement-breakpoint

-- PostgreSQL needs the partial-index predicate in the conflict target. Without
-- it, every delivered/closed order transition fails before the learning event
-- can be written, even though source_event_id is protected by a partial unique
-- index for non-null values.
CREATE OR REPLACE FUNCTION public.enqueue_order_learning_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' THEN RETURN NEW; END IF;
  IF NEW.to_state IN ('delivered', 'closed') THEN
    INSERT INTO public.learning_events(type, payload, source_event_id)
    VALUES (
      CASE WHEN NEW.to_state = 'delivered' THEN 'order_delivered' ELSE 'order_closed' END,
      jsonb_build_object('orderId', NEW.order_id, 'toState', NEW.to_state),
      NEW.id
    )
    ON CONFLICT (source_event_id) WHERE source_event_id IS NOT NULL DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
