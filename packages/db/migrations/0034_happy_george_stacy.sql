ALTER POLICY "attachments_select_buyer" ON "attachments" TO authenticated USING ("attachments"."kind" <> 'supplier_invoice' and exists (
        select 1 from "companies" c where c.id = (select public.current_company_id()) and c.type = 'buyer'
      ) and (
        "attachments"."request_id" in (select id from "requests") or
        "attachments"."order_id" in (select id from "orders") or
        "attachments"."thread_id" in (select id from "threads" where kind = 'buyer') or
        "attachments"."message_id" in (select m.id from "messages" m join "threads" th on th.id = m.thread_id where th.kind = 'buyer')
      ));
--> statement-breakpoint

-- The estimate transition and its P80 invoice are one business operation.
-- The previous function wrote the estimate first and the application then
-- issued the invoice in a second request; a transient failure could leave an
-- estimated order without the invoice required to continue.
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
    IF p_prepayment IS NULL OR p_prepayment->'document' IS NULL
      OR (p_prepayment->>'amount_kzt')::numeric <= 0
      OR p_prepayment->>'status' <> 'issued' THEN
      RAISE EXCEPTION 'Нет корректного счёта на предоплату';
    END IF;
    INSERT INTO public.prepayments(request_id, amount_kzt, invoice_no, status, paid_at)
      VALUES (v_order.request_id, (p_prepayment->>'amount_kzt')::numeric::bigint,
        p_prepayment->>'invoice_no', 'issued'::public.prepayment_status, null)
      ON CONFLICT (request_id) DO UPDATE SET
        amount_kzt = excluded.amount_kzt, invoice_no = excluded.invoice_no,
        status = excluded.status, paid_at = null, updated_at = now();
    INSERT INTO public.documents(order_id, stage, type, url, meta)
      VALUES (v_order.id, 'estimated', 'prepay_invoice', p_prepayment->'document'->>'url',
        coalesce(p_prepayment->'document'->'meta', '{}'::jsonb));
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
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.advance_order_stage(uuid,public.order_state,public.order_state,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.advance_order_stage(uuid,public.order_state,public.order_state,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) TO authenticated;
