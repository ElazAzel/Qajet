-- Policy expressions below call these helpers, so define them before the
-- ALTER POLICY statements are parsed by PostgreSQL.
CREATE OR REPLACE FUNCTION public.supplier_can_access_rfq(p_rfq_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_company_id uuid;
  v_role public.user_role;
  v_company_type public.company_type;
  v_supplier_company_id uuid;
  v_assigned_user_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  SELECT u.company_id, u.role, c.type
  INTO v_company_id, v_role, v_company_type
  FROM public.users u
  LEFT JOIN public.companies c ON c.id = u.company_id
  WHERE u.id = auth.uid() AND u.is_active;
  IF v_company_type IS DISTINCT FROM 'supplier'::public.company_type
    OR v_role NOT IN ('owner'::public.user_role, 'manager'::public.user_role) THEN
    RETURN false;
  END IF;
  SELECT supplier_company_id, assigned_supplier_user_id
  INTO v_supplier_company_id, v_assigned_user_id
  FROM public.rfqs
  WHERE id = p_rfq_id;
  RETURN v_supplier_company_id = v_company_id
    AND (v_role = 'owner'::public.user_role OR v_assigned_user_id IS NULL OR v_assigned_user_id = auth.uid());
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.supplier_can_access_order(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_company_id uuid;
  v_role public.user_role;
  v_company_type public.company_type;
  v_request_id uuid;
  v_plan_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  SELECT u.company_id, u.role, c.type
  INTO v_company_id, v_role, v_company_type
  FROM public.users u
  LEFT JOIN public.companies c ON c.id = u.company_id
  WHERE u.id = auth.uid() AND u.is_active;
  IF v_company_type IS DISTINCT FROM 'supplier'::public.company_type
    OR v_role NOT IN ('owner'::public.user_role, 'manager'::public.user_role) THEN
    RETURN false;
  END IF;
  SELECT request_id, approved_plan_id INTO v_request_id, v_plan_id
  FROM public.orders WHERE id = p_order_id;
  IF v_request_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.plan_lines
    WHERE plan_id = v_plan_id AND supplier_company_id = v_company_id
  ) THEN
    RETURN false;
  END IF;
  IF v_role = 'owner'::public.user_role THEN RETURN true; END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.rfqs r
    WHERE r.request_id = v_request_id
      AND r.supplier_company_id = v_company_id
      AND (r.assigned_supplier_user_id IS NULL OR r.assigned_supplier_user_id = auth.uid())
  );
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.supplier_can_access_plan_line(
  p_plan_id uuid,
  p_supplier_company_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_order_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.plan_lines
    WHERE plan_id = p_plan_id AND supplier_company_id = p_supplier_company_id
  ) THEN
    RETURN false;
  END IF;
  SELECT id INTO v_order_id
  FROM public.orders
  WHERE approved_plan_id = p_plan_id
  LIMIT 1;
  RETURN v_order_id IS NOT NULL AND public.supplier_can_access_order(v_order_id);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.supplier_can_access_plan_line(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.supplier_can_access_plan_line(uuid, uuid) TO authenticated, service_role;
--> statement-breakpoint
DROP POLICY "quote_lines_select_buyer_of_request" ON "quote_lines" CASCADE;--> statement-breakpoint
DROP POLICY "quote_lines_insert_own_supplier" ON "quote_lines" CASCADE;--> statement-breakpoint
DROP POLICY "quotes_insert_own_supplier" ON "quotes" CASCADE;--> statement-breakpoint
DROP POLICY "rfqs_select_buyer_of_request" ON "rfqs" CASCADE;--> statement-breakpoint
DROP POLICY "rfqs_update_own_supplier" ON "rfqs" CASCADE;--> statement-breakpoint
CREATE POLICY "attachments_insert_staff" ON "attachments" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("attachments"."uploaded_by" = (select auth.uid()) and (select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "threads_select_own_supplier" ON "threads" TO authenticated USING ("threads"."kind" = 'supplier' and "threads"."supplier_company_id" = (select public.current_company_id()) and (
        (select public.current_role()) = 'owner' or public.supplier_can_access_order("threads"."order_id")
      ));--> statement-breakpoint
ALTER POLICY "order_supplier_deliveries_select_own_supplier" ON "order_supplier_deliveries" TO authenticated USING ("order_supplier_deliveries"."supplier_company_id" = (select public.current_company_id()) and public.supplier_can_access_order("order_supplier_deliveries"."order_id"));--> statement-breakpoint
ALTER POLICY "order_supplier_deliveries_insert_own_supplier" ON "order_supplier_deliveries" TO authenticated WITH CHECK ("order_supplier_deliveries"."supplier_company_id" = (select public.current_company_id())
        and "order_supplier_deliveries"."confirmed_by" = (select auth.uid())
        and (select public.current_role()) in ('owner', 'manager')
        and exists (
          select 1 from "companies" c where c.id = "order_supplier_deliveries"."supplier_company_id" and c.type = 'supplier'
        )
        and exists (
          select 1 from "orders" o
          join "plan_lines" pl on pl.plan_id = o.approved_plan_id
          where o.id = "order_supplier_deliveries"."order_id"
            and o.state = 'shipped'
            and pl.supplier_company_id = "order_supplier_deliveries"."supplier_company_id"
            and public.supplier_can_access_order("order_supplier_deliveries"."order_id")
        ));--> statement-breakpoint
ALTER POLICY "orders_select_supplier_in_plan" ON "orders" TO authenticated USING (public.supplier_can_access_order("orders"."id"));--> statement-breakpoint
ALTER POLICY "orders_update_supplier_delivery" ON "orders" TO authenticated USING ("orders"."state" = 'shipped' and public.supplier_can_access_order("orders"."id") and exists (
        select 1 from "plan_lines" pl
        where pl.plan_id = "orders"."approved_plan_id"
          and pl.supplier_company_id = (select public.current_company_id())
      )) WITH CHECK ("orders"."state" in ('shipped', 'delivered') and public.supplier_can_access_order("orders"."id") and exists (
        select 1 from "plan_lines" pl
        where pl.plan_id = "orders"."approved_plan_id"
          and pl.supplier_company_id = (select public.current_company_id())
      ));--> statement-breakpoint
ALTER POLICY "payment_facts_select_supplier_own" ON "payment_facts" TO authenticated USING ("payment_facts"."direction" = 'outbound' and "payment_facts"."supplier_company_id" = (select public.current_company_id()) and public.supplier_can_access_order("payment_facts"."order_id"));--> statement-breakpoint
ALTER POLICY "plan_lines_select_own_supplier" ON "plan_lines" TO authenticated USING ("plan_lines"."supplier_company_id" = (select public.current_company_id())
        and (select public.current_role()) in ('owner', 'manager')
        and public.supplier_can_access_plan_line("plan_lines"."plan_id", "plan_lines"."supplier_company_id"));--> statement-breakpoint
ALTER POLICY "quote_lines_select_own_supplier" ON "quote_lines" TO authenticated USING ("quote_lines"."quote_id" in (
        select id from "quotes" where rfq_id in (
          select id from "rfqs" where supplier_company_id = (select public.current_company_id()) and public.supplier_can_access_rfq(id)
        )
      ));--> statement-breakpoint
ALTER POLICY "quotes_select_own_supplier" ON "quotes" TO authenticated USING ("quotes"."rfq_id" in (select id from "rfqs" where supplier_company_id = (select public.current_company_id()) and public.supplier_can_access_rfq(id)));--> statement-breakpoint
ALTER POLICY "rfqs_select_own_supplier" ON "rfqs" TO authenticated USING ("rfqs"."supplier_company_id" = (select public.current_company_id()) and public.supplier_can_access_rfq("rfqs"."id"));--> statement-breakpoint
ALTER POLICY "supplier_payouts_select_own_supplier" ON "supplier_payouts" TO authenticated USING ("supplier_payouts"."supplier_company_id" = (select public.current_company_id()) and public.supplier_can_access_order("supplier_payouts"."order_id"));
--> statement-breakpoint

-- Supplier managers work on assigned RFQs/orders; an unassigned item remains
-- visible so a manager can claim it. Owners keep the whole company view.
CREATE OR REPLACE FUNCTION public.supplier_can_access_rfq(p_rfq_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_company_id uuid;
  v_role public.user_role;
  v_company_type public.company_type;
  v_supplier_company_id uuid;
  v_assigned_user_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  SELECT u.company_id, u.role, c.type
  INTO v_company_id, v_role, v_company_type
  FROM public.users u
  LEFT JOIN public.companies c ON c.id = u.company_id
  WHERE u.id = auth.uid() AND u.is_active;
  IF v_company_type IS DISTINCT FROM 'supplier'::public.company_type
    OR v_role NOT IN ('owner'::public.user_role, 'manager'::public.user_role) THEN
    RETURN false;
  END IF;
  SELECT supplier_company_id, assigned_supplier_user_id
  INTO v_supplier_company_id, v_assigned_user_id
  FROM public.rfqs
  WHERE id = p_rfq_id;
  RETURN v_supplier_company_id = v_company_id
    AND (v_role = 'owner'::public.user_role OR v_assigned_user_id IS NULL OR v_assigned_user_id = auth.uid());
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.supplier_can_access_rfq(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.supplier_can_access_rfq(uuid) TO authenticated, service_role;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.supplier_can_access_order(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_company_id uuid;
  v_role public.user_role;
  v_company_type public.company_type;
  v_request_id uuid;
  v_plan_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  SELECT u.company_id, u.role, c.type
  INTO v_company_id, v_role, v_company_type
  FROM public.users u
  LEFT JOIN public.companies c ON c.id = u.company_id
  WHERE u.id = auth.uid() AND u.is_active;
  IF v_company_type IS DISTINCT FROM 'supplier'::public.company_type
    OR v_role NOT IN ('owner'::public.user_role, 'manager'::public.user_role) THEN
    RETURN false;
  END IF;
  SELECT request_id, approved_plan_id INTO v_request_id, v_plan_id
  FROM public.orders WHERE id = p_order_id;
  IF v_request_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.plan_lines
    WHERE plan_id = v_plan_id AND supplier_company_id = v_company_id
  ) THEN
    RETURN false;
  END IF;
  IF v_role = 'owner'::public.user_role THEN RETURN true; END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.rfqs r
    WHERE r.request_id = v_request_id
      AND r.supplier_company_id = v_company_id
      AND (r.assigned_supplier_user_id IS NULL OR r.assigned_supplier_user_id = auth.uid())
  );
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.supplier_can_access_order(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.supplier_can_access_order(uuid) TO authenticated, service_role;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.supplier_can_access_plan_line(
  p_plan_id uuid,
  p_supplier_company_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_order_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.plan_lines
    WHERE plan_id = p_plan_id AND supplier_company_id = p_supplier_company_id
  ) THEN
    RETURN false;
  END IF;
  SELECT id INTO v_order_id
  FROM public.orders
  WHERE approved_plan_id = p_plan_id
  LIMIT 1;
  RETURN v_order_id IS NOT NULL AND public.supplier_can_access_order(v_order_id);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.supplier_can_access_plan_line(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.supplier_can_access_plan_line(uuid, uuid) TO authenticated, service_role;
--> statement-breakpoint

-- Keep the older RLS helper functions aligned with the assignment rule. They
-- are used by requests/companies policies and must not re-open another
-- supplier's request through a broad company-only lookup.
CREATE OR REPLACE FUNCTION public.rfq_request_ids_for_current_supplier()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT r.request_id
  FROM public.rfqs r
  WHERE public.supplier_can_access_rfq(r.id)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.buyer_company_ids_for_current_supplier()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT DISTINCT r.buyer_company_id
  FROM public.requests r
  JOIN public.rfqs rf ON rf.request_id = r.id
  WHERE public.supplier_can_access_rfq(rf.id)
$$;
--> statement-breakpoint

-- New requests and orders always get their buyer/internal conversation in the
-- same database, independently of which application path created them.
CREATE OR REPLACE FUNCTION public.ensure_request_conversation_threads()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' THEN RETURN NEW; END IF;
  INSERT INTO public.threads(request_id, kind)
  VALUES (NEW.id, 'buyer'::public.thread_kind), (NEW.id, 'internal'::public.thread_kind)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS requests_ensure_conversation_threads ON public.requests;
CREATE TRIGGER requests_ensure_conversation_threads
AFTER INSERT ON public.requests
FOR EACH ROW EXECUTE FUNCTION public.ensure_request_conversation_threads();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.ensure_order_conversation_threads()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' THEN RETURN NEW; END IF;
  INSERT INTO public.threads(order_id, kind)
  VALUES (NEW.id, 'buyer'::public.thread_kind), (NEW.id, 'internal'::public.thread_kind)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.threads(order_id, kind, supplier_company_id)
  SELECT NEW.id, 'supplier'::public.thread_kind, pl.supplier_company_id
  FROM public.plan_lines pl
  WHERE pl.plan_id = NEW.approved_plan_id
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS orders_ensure_conversation_threads ON public.orders;
CREATE TRIGGER orders_ensure_conversation_threads
AFTER INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.ensure_order_conversation_threads();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.ensure_order_supplier_threads_on_plan_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' THEN RETURN NEW; END IF;
  IF NEW.approved_plan_id IS DISTINCT FROM OLD.approved_plan_id THEN
    INSERT INTO public.threads(order_id, kind, supplier_company_id)
    SELECT NEW.id, 'supplier'::public.thread_kind, pl.supplier_company_id
    FROM public.plan_lines pl
    WHERE pl.plan_id = NEW.approved_plan_id
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS orders_ensure_supplier_threads_on_plan_change ON public.orders;
CREATE TRIGGER orders_ensure_supplier_threads_on_plan_change
AFTER UPDATE OF approved_plan_id ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.ensure_order_supplier_threads_on_plan_change();
--> statement-breakpoint

-- An authenticated supplier response claims the RFQ for that employee. A
-- public-link response stays unassigned and can be claimed by the owner.
CREATE OR REPLACE FUNCTION public.assign_supplier_response_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' THEN RETURN NEW; END IF;
  IF NEW.status = 'quoted'::public.rfq_status
    AND NEW.assigned_supplier_user_id IS NULL
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.users u
      JOIN public.companies c ON c.id = u.company_id
      WHERE u.id = auth.uid() AND u.is_active AND u.role IN ('owner', 'manager')
        AND c.type = 'supplier' AND c.is_active AND u.company_id = NEW.supplier_company_id
    ) THEN
    UPDATE public.rfqs SET assigned_supplier_user_id = auth.uid(), updated_at = now()
    WHERE id = NEW.id AND assigned_supplier_user_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS rfqs_assign_response_user ON public.rfqs;
CREATE TRIGGER rfqs_assign_response_user
AFTER UPDATE OF status ON public.rfqs
FOR EACH ROW WHEN (NEW.status = 'quoted' AND NEW.assigned_supplier_user_id IS NULL)
EXECUTE FUNCTION public.assign_supplier_response_user();
--> statement-breakpoint

-- Supplier writes go through the validated RPCs; this removes the broad
-- PostgREST update path while retaining the existing function contracts.
ALTER FUNCTION public.submit_supplier_quote(uuid, jsonb) SECURITY DEFINER;
ALTER FUNCTION public.decline_supplier_rfq(uuid) SECURITY DEFINER;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.assign_supplier_rfq(
  p_rfq_id uuid,
  p_supplier_user_id uuid
) RETURNS public.rfqs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rfq public.rfqs;
  v_actor public.users;
  v_target public.users;
BEGIN
  SELECT * INTO v_actor FROM public.users
  WHERE id = auth.uid() AND is_active AND role = 'owner'::public.user_role;
  IF NOT FOUND OR v_actor.company_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.id = v_actor.company_id AND c.type = 'supplier'::public.company_type AND c.is_active
  ) THEN
    RAISE EXCEPTION 'Назначать RFQ может только владелец компании-поставщика';
  END IF;
  SELECT * INTO v_rfq FROM public.rfqs WHERE id = p_rfq_id FOR UPDATE;
  IF NOT FOUND OR v_rfq.supplier_company_id IS DISTINCT FROM v_actor.company_id THEN
    RAISE EXCEPTION 'RFQ не принадлежит вашей компании';
  END IF;
  IF p_supplier_user_id IS NOT NULL THEN
    SELECT * INTO v_target FROM public.users
    WHERE id = p_supplier_user_id AND company_id = v_actor.company_id
      AND is_active AND role IN ('owner'::public.user_role, 'manager'::public.user_role);
    IF NOT FOUND THEN RAISE EXCEPTION 'Сотрудник не найден или отключён'; END IF;
  END IF;
  UPDATE public.rfqs
  SET assigned_supplier_user_id = p_supplier_user_id, updated_at = now()
  WHERE id = v_rfq.id
  RETURNING * INTO v_rfq;
  RETURN v_rfq;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.assign_supplier_rfq(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.assign_supplier_rfq(uuid, uuid) TO authenticated;
