CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid,
	"order_id" uuid,
	"thread_id" uuid,
	"message_id" uuid,
	"uploaded_by" uuid NOT NULL,
	"object_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"kind" text DEFAULT 'attachment' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "attachments_context_present" CHECK (num_nonnulls("attachments"."request_id", "attachments"."order_id", "attachments"."thread_id", "attachments"."message_id") > 0),
	CONSTRAINT "attachments_size_positive" CHECK ("attachments"."size_bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "lease_id" text;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "leased_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "idempotency_key" text DEFAULT gen_random_uuid()::text NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "provider_message_id" text;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "delivery_error" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_request_id_idx" ON "attachments" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "attachments_order_id_idx" ON "attachments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "attachments_thread_id_idx" ON "attachments" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "attachments_message_id_idx" ON "attachments" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "threads_request_buyer_unique" ON "threads" USING btree ("request_id") WHERE "threads"."request_id" is not null and "threads"."kind" = 'buyer';--> statement-breakpoint
CREATE UNIQUE INDEX "threads_request_internal_unique" ON "threads" USING btree ("request_id") WHERE "threads"."request_id" is not null and "threads"."kind" = 'internal';--> statement-breakpoint
CREATE UNIQUE INDEX "threads_order_buyer_unique" ON "threads" USING btree ("order_id") WHERE "threads"."order_id" is not null and "threads"."kind" = 'buyer';--> statement-breakpoint
CREATE UNIQUE INDEX "threads_order_internal_unique" ON "threads" USING btree ("order_id") WHERE "threads"."order_id" is not null and "threads"."kind" = 'internal';--> statement-breakpoint
CREATE UNIQUE INDEX "threads_order_supplier_unique" ON "threads" USING btree ("order_id","supplier_company_id") WHERE "threads"."order_id" is not null and "threads"."kind" = 'supplier';--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_idempotency_key_idx" ON "outbox" USING btree ("idempotency_key");--> statement-breakpoint
CREATE POLICY "change_requests_insert_buyer" ON "change_requests" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("change_requests"."initiator_user_id" = (select auth.uid()) and "change_requests"."order_id" in (
        select o.id from "orders" o join "requests" r on r.id = o.request_id
        where r.buyer_company_id = (select public.current_company_id())
      ));--> statement-breakpoint
CREATE POLICY "change_requests_update_staff" ON "change_requests" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_role()) in ('concierge', 'admin')) WITH CHECK ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "threads_insert_buyer_own" ON "threads" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("threads"."kind" = 'buyer' and "threads"."supplier_company_id" is null and exists (
        select 1 from "companies" c where c.id = (select public.current_company_id()) and c.type = 'buyer'
      ) and (
        "threads"."request_id" in (select id from "requests") or "threads"."order_id" in (select id from "orders")
      ));--> statement-breakpoint
CREATE POLICY "threads_insert_staff" ON "threads" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "threads_update_staff" ON "threads" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_role()) in ('concierge', 'admin')) WITH CHECK ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "companies_update_staff" ON "companies" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_role()) in ('concierge', 'admin')) WITH CHECK ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "attachments_select_staff" ON "attachments" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "attachments_select_buyer" ON "attachments" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (
        select 1 from "companies" c where c.id = (select public.current_company_id()) and c.type = 'buyer'
      ) and (
        "attachments"."request_id" in (select id from "requests") or
        "attachments"."order_id" in (select id from "orders") or
        "attachments"."thread_id" in (select id from "threads" where kind = 'buyer') or
        "attachments"."message_id" in (select m.id from "messages" m join "threads" th on th.id = m.thread_id where th.kind = 'buyer')
      ));--> statement-breakpoint
CREATE POLICY "attachments_select_supplier" ON "attachments" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((
        "attachments"."thread_id" in (select id from "threads" where kind = 'supplier' and supplier_company_id = (select public.current_company_id())) or
        "attachments"."message_id" in (select m.id from "messages" m join "threads" th on th.id = m.thread_id where th.kind = 'supplier' and th.supplier_company_id = (select public.current_company_id())) or
        "attachments"."order_id" in (select o.id from "orders" o join "plan_lines" pl on pl.plan_id = o.approved_plan_id where pl.supplier_company_id = (select public.current_company_id()))
      ));--> statement-breakpoint
CREATE POLICY "attachments_insert_authenticated" ON "attachments" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("attachments"."uploaded_by" = (select auth.uid()) and (
        "attachments"."request_id" in (select id from "requests") or "attachments"."order_id" in (select id from "orders") or "attachments"."thread_id" in (select id from "threads") or "attachments"."message_id" in (select id from "messages")
      ));--> statement-breakpoint
CREATE POLICY "attachments_delete_staff" ON "attachments" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "attachments_service_all" ON "attachments" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER POLICY "change_requests_select_via_order" ON "change_requests" TO authenticated USING ("change_requests"."order_id" in (
        select o.id from "orders" o join "requests" r on r.id = o.request_id
        where r.buyer_company_id = (select public.current_company_id())
      ) or (select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "threads_select_buyer" ON "threads" TO authenticated USING ("threads"."kind" = 'buyer' and exists (
        select 1 from "companies" c where c.id = (select public.current_company_id()) and c.type = 'buyer'
      ) and (
        "threads"."request_id" in (select id from "requests") or
        "threads"."order_id" in (select id from "orders")
      ));

-- Every request/order gets its client-facing and internal conversation as a
-- database-side invariant. RFQs additionally get an isolated supplier thread
-- for the supplier company; repeated imports stay idempotent.
CREATE OR REPLACE FUNCTION public.ensure_request_threads() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.threads(request_id, kind)
    VALUES (NEW.id, 'buyer'), (NEW.id, 'internal')
    ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.ensure_order_threads() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.threads(order_id, kind)
    VALUES (NEW.id, 'buyer'), (NEW.id, 'internal')
    ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.ensure_rfq_thread() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order_id uuid;
BEGIN
  SELECT id INTO v_order_id FROM public.orders WHERE request_id = NEW.request_id LIMIT 1;
  IF v_order_id IS NOT NULL THEN
    INSERT INTO public.threads(order_id, kind, supplier_company_id)
      VALUES (v_order_id, 'supplier', NEW.supplier_company_id)
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS requests_ensure_threads ON public.requests;
CREATE TRIGGER requests_ensure_threads
AFTER INSERT ON public.requests FOR EACH ROW EXECUTE FUNCTION public.ensure_request_threads();
--> statement-breakpoint
DROP TRIGGER IF EXISTS orders_ensure_threads ON public.orders;
CREATE TRIGGER orders_ensure_threads
AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.ensure_order_threads();
--> statement-breakpoint
DROP TRIGGER IF EXISTS rfqs_ensure_thread ON public.rfqs;
CREATE TRIGGER rfqs_ensure_thread
AFTER INSERT ON public.rfqs FOR EACH ROW EXECUTE FUNCTION public.ensure_rfq_thread();
