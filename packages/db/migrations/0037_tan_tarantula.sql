CREATE TABLE "thread_reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "thread_reads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "correction_reason" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "supersedes_quote_id" uuid;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "submitted_by" uuid;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "revision_reason" text;--> statement-breakpoint
ALTER TABLE "rfqs" ADD COLUMN "revision_requested" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rfqs" ADD COLUMN "revision_note" text;--> statement-breakpoint
ALTER TABLE "thread_reads" ADD CONSTRAINT "thread_reads_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_reads" ADD CONSTRAINT "thread_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "thread_reads_thread_user_unique" ON "thread_reads" USING btree ("thread_id","user_id");--> statement-breakpoint
CREATE INDEX "thread_reads_user_id_idx" ON "thread_reads" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_rfq_version_unique" ON "quotes" USING btree ("rfq_id","version");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_body_valid" CHECK (length(trim("messages"."body")) between 1 and 10000);--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_source_valid" CHECK ("time_entries"."source" in ('auto', 'active', 'manual'));--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_manual_reason_valid" CHECK ("time_entries"."source" <> 'manual' or length(trim(coalesce("time_entries"."correction_reason", ''))) between 5 and 1000);--> statement-breakpoint
CREATE POLICY "messages_update_own" ON "messages" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("messages"."author_user_id" = (select auth.uid()) and "messages"."thread_id" in (select id from "threads")) WITH CHECK ("messages"."author_user_id" = (select auth.uid()) and "messages"."thread_id" in (select id from "threads"));--> statement-breakpoint
CREATE POLICY "thread_reads_select_own" ON "thread_reads" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("thread_reads"."user_id" = (select auth.uid()) and "thread_reads"."thread_id" in (select id from "threads"));--> statement-breakpoint
CREATE POLICY "thread_reads_insert_own" ON "thread_reads" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("thread_reads"."user_id" = (select auth.uid()) and "thread_reads"."thread_id" in (select id from "threads"));--> statement-breakpoint
CREATE POLICY "thread_reads_update_own" ON "thread_reads" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("thread_reads"."user_id" = (select auth.uid()) and "thread_reads"."thread_id" in (select id from "threads")) WITH CHECK ("thread_reads"."user_id" = (select auth.uid()) and "thread_reads"."thread_id" in (select id from "threads"));--> statement-breakpoint
CREATE POLICY "thread_reads_service_all" ON "thread_reads" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER POLICY "plan_lines_select_own_supplier" ON "plan_lines" TO authenticated USING ("plan_lines"."supplier_company_id" = (select public.current_company_id())
        and (select public.current_role()) in ('owner', 'manager')
        and public.supplier_can_access_plan_line("plan_lines"."plan_id", "plan_lines"."supplier_company_id"));
--> statement-breakpoint

-- Payment confirmation is deliberately replay-safe. The previous versions
-- used ON CONFLICT as a last line of defence, but checked the lifecycle and
-- outstanding balance before looking up the idempotency key. A retry after a
-- successful transition therefore failed instead of returning the original
-- result. These replacements validate the key's original intent first.
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
  IF p_amount_kzt <= 0 OR nullif(trim(p_reference), '') IS NULL OR nullif(trim(p_idempotency_key), '') IS NULL THEN
    RAISE EXCEPTION 'Сумма, банковский reference и idempotency key обязательны';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
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
  IF v_order.state <> 'estimated' THEN
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
  );

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
  v_existing public.payment_facts;
  v_expected bigint;
  v_confirmed bigint;
  v_supplier_count integer;
  v_paid_supplier_count integer;
BEGIN
  IF public.current_role() NOT IN ('concierge', 'admin') OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Только сотрудник QAJET может подтвердить выплату';
  END IF;
  IF p_supplier_company_id IS NULL OR p_amount_kzt <= 0
    OR nullif(trim(p_reference), '') IS NULL OR nullif(trim(p_idempotency_key), '') IS NULL THEN
    RAISE EXCEPTION 'Поставщик, сумма, банковский reference и idempotency key обязательны';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заказ не найден'; END IF;

  SELECT * INTO v_existing
  FROM public.payment_facts
  WHERE idempotency_key = trim(p_idempotency_key)
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.order_id IS DISTINCT FROM p_order_id
      OR v_existing.supplier_company_id IS DISTINCT FROM p_supplier_company_id
      OR v_existing.direction IS DISTINCT FROM 'outbound'
      OR v_existing.kind IS DISTINCT FROM 'supplier_payout'
      OR v_existing.amount_kzt IS DISTINCT FROM p_amount_kzt
      OR v_existing.reference IS DISTINCT FROM trim(p_reference)
      OR v_existing.status IS DISTINCT FROM 'confirmed' THEN
      RAISE EXCEPTION 'Idempotency key уже используется для другого платежа';
    END IF;
    RETURN v_order;
  END IF;
  IF v_order.state NOT IN ('plan_approved', 'on_hold') THEN
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
  );

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
  v_existing public.payment_facts;
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
  IF NOT FOUND THEN RAISE EXCEPTION 'Заказ не найден'; END IF;

  SELECT * INTO v_existing
  FROM public.payment_facts
  WHERE idempotency_key = trim(p_idempotency_key)
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.order_id IS DISTINCT FROM p_order_id
      OR v_existing.direction IS DISTINCT FROM p_direction
      OR v_existing.kind IS DISTINCT FROM p_kind
      OR v_existing.amount_kzt IS DISTINCT FROM p_amount_kzt
      OR v_existing.reference IS DISTINCT FROM trim(p_reference)
      OR v_existing.status IS DISTINCT FROM 'confirmed' THEN
      RAISE EXCEPTION 'Idempotency key уже используется для другого платежа';
    END IF;
    RETURN v_order;
  END IF;
  IF v_order.state <> 'accepted' THEN
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
  );
  RETURN v_order;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.confirm_settlement_payment(uuid, text, text, bigint, text, timestamptz, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.confirm_settlement_payment(uuid, text, text, bigint, text, timestamptz, text, text) TO authenticated;
--> statement-breakpoint

-- A supplier quote is immutable history. Staff can request a correction; the
-- supplier then submits a new version, while the previous quote and its
-- author remain available to the staff audit trail.
CREATE OR REPLACE FUNCTION public.request_supplier_quote_revision(
  p_rfq_id uuid,
  p_note text
) RETURNS public.rfqs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_rfq public.rfqs;
  v_note text := nullif(trim(p_note), '');
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
  UPDATE public.rfqs
  SET revision_requested = true, revision_note = v_note, updated_at = now()
  WHERE id = p_rfq_id
  RETURNING * INTO v_rfq;
  RETURN v_rfq;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.request_supplier_quote_revision(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.request_supplier_quote_revision(uuid, text) TO authenticated;
--> statement-breakpoint

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
  v_value numeric;
  v_min_qty integer;
  v_setup_fee bigint;
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
    FOR v_value IN SELECT value::text::numeric FROM jsonb_each(v_line)
      WHERE key IN ('unitPriceKzt', 'leadTimeDays', 'setupFeeKzt', 'minQty') AND value <> 'null'::jsonb LOOP
      IF v_value <> trunc(v_value) OR v_value < 0 OR v_value > 9007199254740991 THEN
        RAISE EXCEPTION 'Цена, срок и количество должны быть целыми неотрицательными числами';
      END IF;
    END LOOP;
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
    INSERT INTO public.quote_lines(
      quote_id, request_item_id, unit_price_kzt, lead_time_days,
      setup_fee_kzt, min_qty, capability_confirmed, field_flags
    ) VALUES (
      v_quote, v_item_id, (v_line->>'unitPriceKzt')::numeric::bigint,
      (v_line->>'leadTimeDays')::numeric::integer,
      coalesce(v_setup_fee, 0), v_min_qty, true, v_field_flags
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

-- Manual negative corrections may reduce a total, but never below zero.
-- Enforce this at the database boundary as well as in the action so direct
-- PostgREST writes cannot manufacture negative service time.
CREATE OR REPLACE FUNCTION public.guard_time_entry_total() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_total bigint;
BEGIN
  SELECT coalesce(sum(seconds), 0) INTO v_total
  FROM public.time_entries
  WHERE order_id = NEW.order_id AND id IS DISTINCT FROM NEW.id;
  IF v_total + NEW.seconds < 0 THEN
    RAISE EXCEPTION 'Сумма учёта времени по заказу не может быть отрицательной';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS time_entries_nonnegative_total ON public.time_entries;
CREATE TRIGGER time_entries_nonnegative_total
BEFORE INSERT OR UPDATE OF order_id, seconds ON public.time_entries
FOR EACH ROW EXECUTE FUNCTION public.guard_time_entry_total();
--> statement-breakpoint

-- Two visible tabs for the same order must not count the same person twice.
-- A short database advisory lock makes the ownership check race-free; the
-- most recently heartbeating interval owns the minute, and a second tab is a
-- harmless no-op until the first one has been quiet for 65 seconds.
CREATE OR REPLACE FUNCTION public.record_active_time_heartbeat(
  p_order_id uuid,
  p_stage public.time_entry_stage,
  p_interval_id text,
  p_started_at timestamptz
) RETURNS public.time_entries
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_entry public.time_entries;
  v_other public.time_entries;
  v_start timestamptz;
  v_increment integer;
BEGIN
  IF public.current_role() NOT IN ('concierge', 'admin') OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Активное время записывает только сотрудник QAJET';
  END IF;
  IF p_interval_id IS NULL OR length(trim(p_interval_id)) < 16 OR length(p_interval_id) > 120 THEN
    RAISE EXCEPTION 'Некорректный идентификатор активного интервала';
  END IF;
  IF p_started_at IS NULL OR p_started_at > v_now + interval '5 minutes' THEN
    RAISE EXCEPTION 'Некорректное начало активного интервала';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.orders
    WHERE id = p_order_id AND state NOT IN ('closed', 'cancelled')
  ) THEN
    RAISE EXCEPTION 'Заказ недоступен для активного учёта';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(format('%s:%s:%s', p_order_id, auth.uid(), p_stage), 0)
  );
  SELECT * INTO v_other
  FROM public.time_entries
  WHERE order_id = p_order_id
    AND user_id = auth.uid()
    AND stage = p_stage
    AND source = 'active'
    AND interval_id IS DISTINCT FROM p_interval_id
    AND coalesce(ended_at, started_at) >= v_now - interval '65 seconds'
  ORDER BY coalesce(ended_at, started_at) DESC
  LIMIT 1;
  IF FOUND THEN RETURN v_other; END IF;

  v_start := least(p_started_at, v_now);
  v_increment := least(60, greatest(0, floor(extract(epoch FROM (v_now - v_start)))::integer));

  INSERT INTO public.time_entries(
    order_id, user_id, stage, seconds, source, interval_id, started_at, ended_at
  ) VALUES (
    p_order_id, auth.uid(), p_stage, v_increment, 'active', p_interval_id, v_start, v_now
  )
  ON CONFLICT (interval_id) DO UPDATE SET
    seconds = least(
      28800,
      public.time_entries.seconds + least(
        60,
        greatest(
          0,
          floor(extract(epoch FROM (v_now - coalesce(public.time_entries.ended_at, public.time_entries.started_at))))::integer
        )
      )
    ),
    ended_at = greatest(public.time_entries.ended_at, v_now),
    updated_at = v_now
  RETURNING * INTO v_entry;
  RETURN v_entry;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.record_active_time_heartbeat(uuid, public.time_entry_stage, text, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_active_time_heartbeat(uuid, public.time_entry_stage, text, timestamptz) TO authenticated;
--> statement-breakpoint

-- Store the complete comparison result in one revision. The selected plan is
-- only a pointer on the order; the other proposed variants remain available
-- for the buyer to compare and select before approval.
CREATE OR REPLACE FUNCTION public.propose_order_plans(
  p_order_id uuid,
  p_expected_state public.order_state,
  p_plans jsonb,
  p_rejections jsonb,
  p_selected_kind public.plan_kind
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
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
    UPDATE public.plans SET status = 'superseded', updated_at = now() WHERE id = v_old_plan_id;
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
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.propose_order_plans(uuid, public.order_state, jsonb, jsonb, public.plan_kind) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.propose_order_plans(uuid, public.order_state, jsonb, jsonb, public.plan_kind) TO authenticated;
--> statement-breakpoint

-- Buyer selection is an optimistic-pointer update. It never edits money,
-- lines, or a plan's history, and it cannot point outside this request.
CREATE OR REPLACE FUNCTION public.select_order_plan(
  p_order_id uuid,
  p_expected_plan_id uuid,
  p_plan_id uuid
) RETURNS public.orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user public.users;
  v_order public.orders;
  v_plan public.plans;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE id = auth.uid() AND is_active;
  IF NOT FOUND OR v_user.role NOT IN ('owner', 'manager') OR NOT EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.id = v_user.company_id AND c.type = 'buyer' AND c.is_active
  ) THEN
    RAISE EXCEPTION 'Только покупатель может выбрать вариант';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.requests r
    WHERE r.id = v_order.request_id AND r.buyer_company_id = v_user.company_id
  ) THEN
    RAISE EXCEPTION 'Нет доступа к заказу';
  END IF;
  IF v_order.approved_plan_id IS DISTINCT FROM p_expected_plan_id THEN
    RAISE EXCEPTION 'Варианты уже изменились — обновите страницу';
  END IF;
  IF v_order.state NOT IN ('plan_proposed', 'awaiting_internal_approval') THEN
    RAISE EXCEPTION 'Вариант можно выбрать только до утверждения плана';
  END IF;
  SELECT * INTO v_plan FROM public.plans
  WHERE id = p_plan_id AND request_id = v_order.request_id AND status = 'proposed'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Вариант больше недоступен'; END IF;
  UPDATE public.orders SET approved_plan_id = v_plan.id, updated_at = now()
  WHERE id = v_order.id AND approved_plan_id = p_expected_plan_id
  RETURNING * INTO v_order;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заказ уже изменён — обновите страницу'; END IF;
  RETURN v_order;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.select_order_plan(uuid, uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.select_order_plan(uuid, uuid, uuid) TO authenticated;
