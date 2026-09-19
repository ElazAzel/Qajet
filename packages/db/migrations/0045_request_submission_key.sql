ALTER TABLE "requests" ADD COLUMN "submission_key" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "requests_created_by_submission_key_unique" ON "requests" USING btree ("created_by","submission_key") WHERE "requests"."submission_key" is not null;
--> statement-breakpoint
-- Идемпотентная отправка заявки: покупатель нажал «Отправить» дважды или
-- повторил после обрыва сети — заявка должна быть одна. Раньше защитой была
-- только блокировка кнопки на клиенте. Старая семиаргументная функция
-- удаляется: два перегруза с DEFAULT делают вызов по именам неоднозначным.
DROP FUNCTION IF EXISTS public.create_request_with_items(text, text, date, bigint, text, text, jsonb);--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.create_request_with_items(p_title text, p_raw_text text, p_deadline_date date, p_budget_kzt bigint, p_delivery_address text, p_city text, p_items jsonb, p_submission_key uuid DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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

  -- Повторная отправка той же формы (двойной клик, повтор после обрыва сети)
  -- возвращает уже созданную заявку, а не заводит вторую.
  IF p_submission_key IS NOT NULL THEN
    SELECT r.id INTO v_request_id
    FROM public.requests r
    WHERE r.created_by = auth.uid() AND r.submission_key = p_submission_key;
    IF FOUND THEN
      RETURN v_request_id;
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.requests(
      buyer_company_id, created_by, title, raw_text, deadline_date,
      budget_kzt, delivery_address, city, status, submission_key
    ) VALUES (
      v_company_id, auth.uid(), trim(p_title), coalesce(p_raw_text, ''), p_deadline_date,
      p_budget_kzt, nullif(trim(p_delivery_address), ''), nullif(trim(p_city), ''), 'submitted',
      p_submission_key
    ) RETURNING id INTO v_request_id;
  EXCEPTION WHEN unique_violation THEN
    -- Две одновременные отправки одной формы: проигравшая находит победившую.
    SELECT r.id INTO v_request_id
    FROM public.requests r
    WHERE r.created_by = auth.uid() AND r.submission_key = p_submission_key;
    IF v_request_id IS NULL THEN RAISE; END IF;
    RETURN v_request_id;
  END;

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
$function$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.create_request_with_items(text, text, date, bigint, text, text, jsonb, uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.create_request_with_items(text, text, date, bigint, text, text, jsonb, uuid) TO authenticated;
