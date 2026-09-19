-- Учёт активного времени: record_active_time_heartbeat падал с SQLSTATE 42P10.
-- Воспроизведено packages/db/src/__tests__/time-heartbeat.test.ts.
--
-- Уникальный индекс time_entries_interval_id_idx частичный
-- (WHERE interval_id IS NOT NULL), а ON CONFLICT (interval_id) без такого же
-- предиката его не выбирает: «there is no unique or exclusion constraint
-- matching the ON CONFLICT specification». Функция не работала ни разу, поэтому
-- часы консьержа не копились, а на его экране висела красная ошибка.
-- Меняется только предикат конфликта, остальное тело — как в 0037.
CREATE OR REPLACE FUNCTION public.record_active_time_heartbeat(p_order_id uuid, p_stage time_entry_stage, p_interval_id text, p_started_at timestamp with time zone)
 RETURNS time_entries
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  ON CONFLICT (interval_id) WHERE interval_id IS NOT NULL DO UPDATE SET
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
$function$;
