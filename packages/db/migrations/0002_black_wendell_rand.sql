CREATE POLICY "companies_select_supplier_via_rfq" ON "companies" AS PERMISSIVE FOR SELECT TO "authenticated" USING (id in (
        select r.buyer_company_id from requests r
        join rfqs rf on rf.request_id = r.id
        where rf.supplier_company_id = public.current_company_id()
      ));--> statement-breakpoint
CREATE POLICY "estimates_insert_staff" ON "estimates" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (public.current_role() in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "orders_insert_staff" ON "orders" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (public.current_role() in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "prepayments_insert_staff" ON "prepayments" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (public.current_role() in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "quote_lines_insert_own_supplier" ON "quote_lines" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("quote_lines"."quote_id" in (
        select id from "quotes" where rfq_id in (
          select id from "rfqs" where supplier_company_id = public.current_company_id()
        )
      ));--> statement-breakpoint
CREATE POLICY "request_items_insert_buyer_own" ON "request_items" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("request_items"."request_id" in (
        select id from "requests" where buyer_company_id = public.current_company_id()
      ));--> statement-breakpoint
CREATE POLICY "requests_update_staff" ON "requests" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (public.current_role() in ('concierge', 'admin')) WITH CHECK (public.current_role() in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "requests_select_supplier_via_rfq" ON "requests" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("requests"."id" in (select request_id from rfqs where supplier_company_id = public.current_company_id()));--> statement-breakpoint
CREATE POLICY "rfqs_insert_staff" ON "rfqs" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (public.current_role() in ('concierge', 'admin'));