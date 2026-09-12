-- Close the live supplier-learning loop: a buyer can rate only a closed order,
-- and RFQ/quote/rating activity keeps supplier_stats current without granting
-- clients direct write access to the aggregate table.
CREATE UNIQUE INDEX IF NOT EXISTS ratings_order_supplier_unique
  ON public.ratings(order_id, supplier_company_id);--> statement-breakpoint

DROP POLICY IF EXISTS ratings_insert_via_order ON public.ratings;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.refresh_supplier_stats(p_supplier_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_orders_total integer;
  v_orders_on_time integer;
  v_orders_disputed integer;
  v_avg_buyer_score integer;
  v_rfq_sent integer;
  v_rfq_answered integer;
  v_median_response_hours integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.companies WHERE id = p_supplier_company_id
  ) THEN
    RETURN;
  END IF;

  SELECT
    count(*)::integer,
    (count(*) FILTER (WHERE was_on_time))::integer,
    (count(*) FILTER (WHERE had_dispute))::integer,
    CASE WHEN count(buyer_score_1_5) = 0 THEN NULL
      ELSE round(avg(buyer_score_1_5))::integer
    END
  INTO v_orders_total, v_orders_on_time, v_orders_disputed, v_avg_buyer_score
  FROM public.ratings
  WHERE supplier_company_id = p_supplier_company_id;

  SELECT count(*)::integer
  INTO v_rfq_sent
  FROM public.rfqs
  WHERE supplier_company_id = p_supplier_company_id;

  SELECT
    count(DISTINCT r.id)::integer,
    CASE WHEN count(q.id) = 0 THEN NULL
      ELSE round(
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY greatest(0, extract(epoch FROM (q.created_at - r.sent_at)) / 3600)
        )::numeric
      )::integer
    END
  INTO v_rfq_answered, v_median_response_hours
  FROM public.rfqs r
  JOIN public.quotes q ON q.rfq_id = r.id
  WHERE r.supplier_company_id = p_supplier_company_id;

  INSERT INTO public.supplier_stats(
    company_id,
    orders_total,
    orders_on_time,
    orders_disputed,
    avg_buyer_score,
    rfq_sent,
    rfq_answered,
    median_response_hours,
    updated_at
  ) VALUES (
    p_supplier_company_id,
    coalesce(v_orders_total, 0),
    coalesce(v_orders_on_time, 0),
    coalesce(v_orders_disputed, 0),
    v_avg_buyer_score,
    coalesce(v_rfq_sent, 0),
    coalesce(v_rfq_answered, 0),
    v_median_response_hours,
    now()
  )
  ON CONFLICT (company_id) DO UPDATE SET
    orders_total = EXCLUDED.orders_total,
    orders_on_time = EXCLUDED.orders_on_time,
    orders_disputed = EXCLUDED.orders_disputed,
    avg_buyer_score = EXCLUDED.avg_buyer_score,
    rfq_sent = EXCLUDED.rfq_sent,
    rfq_answered = EXCLUDED.rfq_answered,
    median_response_hours = EXCLUDED.median_response_hours,
    updated_at = now();
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.refresh_supplier_stats_after_rfq()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.refresh_supplier_stats(NEW.supplier_company_id);
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.refresh_supplier_stats_after_quote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_supplier_company_id uuid;
BEGIN
  SELECT supplier_company_id INTO v_supplier_company_id
  FROM public.rfqs
  WHERE id = NEW.rfq_id;
  IF v_supplier_company_id IS NOT NULL THEN
    PERFORM public.refresh_supplier_stats(v_supplier_company_id);
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.refresh_supplier_stats_after_rating()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_supplier_company_id uuid;
BEGIN
  v_supplier_company_id := CASE WHEN TG_OP = 'DELETE'
    THEN OLD.supplier_company_id ELSE NEW.supplier_company_id END;
  PERFORM public.refresh_supplier_stats(v_supplier_company_id);
  IF TG_OP = 'UPDATE' AND OLD.supplier_company_id IS DISTINCT FROM NEW.supplier_company_id THEN
    PERFORM public.refresh_supplier_stats(OLD.supplier_company_id);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS ratings_refresh_supplier_stats ON public.ratings;--> statement-breakpoint
CREATE TRIGGER ratings_refresh_supplier_stats
  AFTER INSERT OR UPDATE OR DELETE ON public.ratings
  FOR EACH ROW
  EXECUTE FUNCTION public.refresh_supplier_stats_after_rating();--> statement-breakpoint

DROP TRIGGER IF EXISTS rfqs_refresh_supplier_stats ON public.rfqs;--> statement-breakpoint
CREATE TRIGGER rfqs_refresh_supplier_stats
  AFTER INSERT ON public.rfqs
  FOR EACH ROW
  EXECUTE FUNCTION public.refresh_supplier_stats_after_rfq();--> statement-breakpoint

DROP TRIGGER IF EXISTS quotes_refresh_supplier_stats ON public.quotes;--> statement-breakpoint
CREATE TRIGGER quotes_refresh_supplier_stats
  AFTER INSERT ON public.quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.refresh_supplier_stats_after_quote();--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.get_buyer_rating_targets(p_order_id uuid)
RETURNS TABLE(supplier_company_id uuid, rated boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  SELECT u.company_id INTO v_company_id
  FROM public.users u
  JOIN public.companies c ON c.id = u.company_id
  WHERE u.id = auth.uid()
    AND u.is_active
    AND u.role IN ('owner', 'manager')
    AND c.type = 'buyer'
    AND c.is_active;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Только активный пользователь компании-покупателя может видеть оценки';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.requests r ON r.id = o.request_id
    WHERE o.id = p_order_id
      AND o.state = 'closed'
      AND r.buyer_company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'Оценка доступна только по закрытому заказу своей компании';
  END IF;

  RETURN QUERY
  SELECT DISTINCT
    pl.supplier_company_id,
    EXISTS (
      SELECT 1 FROM public.ratings rating
      WHERE rating.order_id = p_order_id
        AND rating.supplier_company_id = pl.supplier_company_id
    ) AS rated
  FROM public.orders o
  JOIN public.plan_lines pl ON pl.plan_id = o.approved_plan_id
  WHERE o.id = p_order_id;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.submit_supplier_rating(
  p_order_id uuid,
  p_supplier_company_id uuid,
  p_buyer_score integer,
  p_was_on_time boolean,
  p_had_dispute boolean,
  p_comment text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  SELECT u.company_id INTO v_company_id
  FROM public.users u
  JOIN public.companies c ON c.id = u.company_id
  WHERE u.id = auth.uid()
    AND u.is_active
    AND u.role IN ('owner', 'manager')
    AND c.type = 'buyer'
    AND c.is_active;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Только активный пользователь компании-покупателя может оценивать поставщика';
  END IF;

  IF p_buyer_score IS NULL OR p_buyer_score < 1 OR p_buyer_score > 5
    OR p_was_on_time IS NULL OR p_had_dispute IS NULL THEN
    RAISE EXCEPTION 'Оценка и исходы исполнения указаны некорректно';
  END IF;
  IF p_comment IS NOT NULL AND length(p_comment) > 2000 THEN
    RAISE EXCEPTION 'Комментарий не должен быть длиннее 2000 символов';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.requests r ON r.id = o.request_id
    WHERE o.id = p_order_id
      AND o.state = 'closed'
      AND r.buyer_company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'Оценка доступна только по закрытому заказу своей компании';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.plan_lines pl ON pl.plan_id = o.approved_plan_id
    WHERE o.id = p_order_id
      AND pl.supplier_company_id = p_supplier_company_id
  ) THEN
    RAISE EXCEPTION 'Поставщик не входит в утверждённый план этого заказа';
  END IF;

  INSERT INTO public.ratings(
    order_id,
    supplier_company_id,
    buyer_score_1_5,
    was_on_time,
    had_dispute,
    comment
  ) VALUES (
    p_order_id,
    p_supplier_company_id,
    p_buyer_score,
    p_was_on_time,
    p_had_dispute,
    NULLIF(btrim(p_comment), '')
  );

  RETURN true;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Оценка для этого поставщика уже отправлена';
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.refresh_supplier_stats(uuid) FROM public, anon, authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.refresh_supplier_stats_after_rfq() FROM public, anon, authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.refresh_supplier_stats_after_quote() FROM public, anon, authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.refresh_supplier_stats_after_rating() FROM public, anon, authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.get_buyer_rating_targets(uuid) FROM public, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.get_buyer_rating_targets(uuid) TO authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.submit_supplier_rating(uuid,uuid,integer,boolean,boolean,text) FROM public, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.submit_supplier_rating(uuid,uuid,integer,boolean,boolean,text) TO authenticated;
