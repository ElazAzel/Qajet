ALTER TABLE "learning_events" ADD COLUMN "source_event_id" uuid;--> statement-breakpoint
ALTER TABLE "learning_events" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_events" ADD COLUMN "lease_id" text;--> statement-breakpoint
ALTER TABLE "learning_events" ADD COLUMN "leased_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "learning_events" ADD COLUMN "available_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_events" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "price_observations" ADD COLUMN "source" text DEFAULT 'historical' NOT NULL;--> statement-breakpoint
ALTER TABLE "price_observations" ADD COLUMN "source_event_id" uuid;--> statement-breakpoint
ALTER TABLE "price_observations" ADD COLUMN "observation_key" text;--> statement-breakpoint
ALTER TABLE "learning_events" ADD CONSTRAINT "learning_events_source_event_id_order_stage_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."order_stage_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_source_event_id_learning_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."learning_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "learning_events_source_event_unique" ON "learning_events" USING btree ("source_event_id") WHERE "learning_events"."source_event_id" is not null;--> statement-breakpoint
CREATE INDEX "learning_events_queue_idx" ON "learning_events" USING btree ("processed_at","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "price_observations_observation_key_unique" ON "price_observations" USING btree ("observation_key") WHERE "price_observations"."observation_key" is not null;
--> statement-breakpoint

-- Delivery/closure learning work is enqueued by the same transaction that
-- writes the immutable stage event. Seed/service-role inserts are excluded so
-- synthetic history does not become a second live training run.
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
    ON CONFLICT (source_event_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS order_stage_events_learning_enqueue ON public.order_stage_events;
CREATE TRIGGER order_stage_events_learning_enqueue
AFTER INSERT ON public.order_stage_events
FOR EACH ROW EXECUTE FUNCTION public.enqueue_order_learning_event();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.claim_learning_events(
  p_limit integer DEFAULT 10,
  p_lease_id text DEFAULT gen_random_uuid()::text
) RETURNS SETOF public.learning_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF current_setting('role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'Только worker service_role может забирать learning events';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT id
    FROM public.learning_events
    WHERE processed_at IS NULL
      AND available_at <= now()
      AND (leased_until IS NULL OR leased_until < now())
    ORDER BY created_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(coalesce(p_limit, 10), 100))
  )
  UPDATE public.learning_events e
  SET lease_id = p_lease_id,
      leased_until = now() + interval '5 minutes',
      attempts = e.attempts + 1
  FROM candidates
  WHERE e.id = candidates.id
  RETURNING e.*;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.claim_learning_events(integer, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_learning_events(integer, text) TO service_role;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.complete_learning_event(
  p_id uuid,
  p_lease_id text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF current_setting('role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'Только worker service_role может завершить learning event';
  END IF;
  UPDATE public.learning_events
  SET processed_at = now(), lease_id = null, leased_until = null,
      last_error = null
  WHERE id = p_id AND processed_at IS NULL AND lease_id = p_lease_id;
  RETURN FOUND;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.complete_learning_event(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_learning_event(uuid, text) TO service_role;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.fail_learning_event(
  p_id uuid,
  p_lease_id text,
  p_error text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempts integer;
BEGIN
  IF current_setting('role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'Только worker service_role может вернуть learning event в retry';
  END IF;
  SELECT attempts INTO v_attempts
  FROM public.learning_events
  WHERE id = p_id AND processed_at IS NULL AND lease_id = p_lease_id;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.learning_events
  SET lease_id = null,
      leased_until = null,
      last_error = left(coalesce(p_error, 'Неизвестная ошибка'), 2000),
      available_at = now() + make_interval(secs => least(3600, greatest(30, 30 * power(2, least(v_attempts - 1, 6)))::integer))
  WHERE id = p_id AND lease_id = p_lease_id;
  RETURN true;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.fail_learning_event(uuid, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_learning_event(uuid, text, text) TO service_role;
--> statement-breakpoint

-- Keep the approval evidence in the immutable event without exposing supplier
-- pricing: the event carries the approved plan id and version, while the
-- buyer-facing payload remains totals-only.
CREATE OR REPLACE FUNCTION public.audit_order_stage_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_plan_version integer;
BEGIN
  IF OLD.state = NEW.state THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Переход заказа требует аутентифицированного автора';
  END IF;
  SELECT version INTO v_plan_version FROM public.plans WHERE id = NEW.approved_plan_id;
  INSERT INTO public.order_stage_events(order_id, from_state, to_state, actor_user_id, note)
  VALUES (
    NEW.id,
    OLD.state,
    NEW.state,
    auth.uid(),
    format(
      'Переход %s → %s%s',
      OLD.state,
      NEW.state,
      CASE
        WHEN v_plan_version IS NULL THEN ''
        ELSE format('; версия плана %s (%s)', v_plan_version, NEW.approved_plan_id)
      END
    )
  );
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- The stage-audit trigger is the single writer of order_stage_events. Older
-- approval definitions inserted a second manual audit row after changing the
-- order, so keep the atomic optimistic-lock checks but let the trigger record
-- this transition exactly once.
CREATE OR REPLACE FUNCTION public.approve_plan(
  p_order_id uuid,
  p_expected_plan_id uuid,
  p_expected_plan_version integer
) RETURNS public.plans
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
  IF v_order.approved_plan_id IS DISTINCT FROM p_expected_plan_id THEN
    RAISE EXCEPTION 'План уже изменён — обновите страницу';
  END IF;
  SELECT * INTO v_plan
  FROM public.plans
  WHERE id = v_order.approved_plan_id AND request_id = v_order.request_id
  FOR UPDATE;
  IF NOT FOUND OR v_plan.version IS DISTINCT FROM p_expected_plan_version THEN
    RAISE EXCEPTION 'Версия плана уже изменена — обновите страницу';
  END IF;
  IF v_order.state = 'plan_approved' AND v_plan.status = 'approved' THEN RETURN v_plan; END IF;
  IF v_order.state NOT IN ('plan_proposed', 'awaiting_internal_approval', 'on_hold')
    OR v_plan.status <> 'proposed' THEN
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
  IF v_next = 'plan_approved' THEN
    UPDATE public.plans
    SET status = 'approved', updated_at = now()
    WHERE id = v_plan.id
    RETURNING * INTO v_plan;
  END IF;
  UPDATE public.orders SET state = v_next, updated_at = now() WHERE id = v_order.id;
  RETURN v_plan;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.approve_plan(uuid, uuid, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.approve_plan(uuid, uuid, integer) TO authenticated;
