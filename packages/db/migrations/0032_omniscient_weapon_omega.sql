ALTER TABLE "time_entries" ADD COLUMN "interval_id" text;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "time_entries_interval_id_idx" ON "time_entries" USING btree ("interval_id") WHERE "time_entries"."interval_id" is not null;--> statement-breakpoint
CREATE POLICY "time_entries_update_own_active" ON "time_entries" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_role()) in ('concierge', 'admin') and "time_entries"."user_id" = auth.uid() and "time_entries"."source" = 'active') WITH CHECK ((select public.current_role()) in ('concierge', 'admin') and "time_entries"."user_id" = auth.uid() and "time_entries"."source" = 'active' and "time_entries"."seconds" >= 0);--> statement-breakpoint
ALTER POLICY "time_entries_insert_own" ON "time_entries" TO authenticated WITH CHECK ((select public.current_role()) in ('concierge', 'admin') and "time_entries"."user_id" = auth.uid());
--> statement-breakpoint

-- A retry with an already-used key is idempotent only when it carries the
-- same business fact. Otherwise ON CONFLICT DO NOTHING could acknowledge a
-- changed amount/reference as if the second transfer had been recorded.
CREATE OR REPLACE FUNCTION public.guard_payment_idempotency() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_existing public.payment_facts;
BEGIN
  SELECT * INTO v_existing
  FROM public.payment_facts
  WHERE idempotency_key = NEW.idempotency_key;
  IF FOUND AND (
    v_existing.order_id IS DISTINCT FROM NEW.order_id OR
    v_existing.supplier_company_id IS DISTINCT FROM NEW.supplier_company_id OR
    v_existing.direction IS DISTINCT FROM NEW.direction OR
    v_existing.kind IS DISTINCT FROM NEW.kind OR
    v_existing.amount_kzt IS DISTINCT FROM NEW.amount_kzt OR
    v_existing.reference IS DISTINCT FROM NEW.reference
  ) THEN
    RAISE EXCEPTION 'Idempotency key уже связана с другим платёжным фактом';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS payment_facts_idempotency_guard ON public.payment_facts;
CREATE TRIGGER payment_facts_idempotency_guard
BEFORE INSERT ON public.payment_facts
FOR EACH ROW EXECUTE FUNCTION public.guard_payment_idempotency();
--> statement-breakpoint

-- Active work is recorded as one append-safe interval. A replay of the same
-- interval updates the existing row, while a delayed browser heartbeat can
-- contribute at most one minute. The database clock is authoritative.
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
