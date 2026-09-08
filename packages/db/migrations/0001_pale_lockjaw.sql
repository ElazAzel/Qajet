CREATE POLICY "order_stage_events_insert_actor" ON "order_stage_events" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("order_stage_events"."actor_user_id" = (select auth.uid()) and (
        public.current_role() in ('concierge', 'admin')
        or "order_stage_events"."order_id" in (
          select o.id from "orders" o
          join "requests" r on r.id = o.request_id
          where r.buyer_company_id = public.current_company_id()
        )
      ));--> statement-breakpoint
CREATE POLICY "orders_update_staff" ON "orders" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (public.current_role() in ('concierge', 'admin')) WITH CHECK (public.current_role() in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "orders_update_buyer_own" ON "orders" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("orders"."request_id" in (
        select id from "requests" where buyer_company_id = public.current_company_id()
      )) WITH CHECK ("orders"."request_id" in (
        select id from "requests" where buyer_company_id = public.current_company_id()
      ));--> statement-breakpoint
CREATE POLICY "plan_lines_insert_staff" ON "plan_lines" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (public.current_role() in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "plan_rejections_insert_staff" ON "plan_rejections" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (public.current_role() in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "plans_insert_staff" ON "plans" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (public.current_role() in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "plans_update_staff" ON "plans" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (public.current_role() in ('concierge', 'admin')) WITH CHECK (public.current_role() in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "plans_update_buyer_own" ON "plans" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("plans"."request_id" in (
        select id from "requests" where buyer_company_id = public.current_company_id()
      )) WITH CHECK ("plans"."request_id" in (
        select id from "requests" where buyer_company_id = public.current_company_id()
      ));--> statement-breakpoint
CREATE POLICY "supplier_payouts_insert_staff" ON "supplier_payouts" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (public.current_role() in ('concierge', 'admin'));--> statement-breakpoint
-- Второй, независимый барьер поверх RLS: даже если клиент, у которого есть
-- право на UPDATE orders (staff или сам покупатель — см. policy выше),
-- отправит запрос напрямую мимо server action, Postgres откажет в переходе,
-- которого нет в графе. Источник истины для самого графа —
-- packages/engine/src/order/transition.ts (agents.md §6); здесь всего лишь
-- пары from→to без проверки актёра — актёра ограничивают policy на UPDATE.
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
    ('disputed', 'on_hold'),
    ('accepted', 'closed')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'order_state_transition: % -> % не определён в машине состояний', OLD.state, NEW.state
    USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS orders_enforce_transition ON "orders";
CREATE TRIGGER orders_enforce_transition
  BEFORE UPDATE ON "orders"
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_order_transition();
