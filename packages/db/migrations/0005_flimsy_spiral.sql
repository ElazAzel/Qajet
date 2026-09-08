ALTER POLICY "threads_select_staff" ON "threads" TO authenticated USING ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "threads_select_own_supplier" ON "threads" TO authenticated USING ("threads"."kind" = 'supplier' and "threads"."supplier_company_id" = (select public.current_company_id()));--> statement-breakpoint
ALTER POLICY "companies_select_own" ON "companies" TO authenticated USING (id = (select public.current_company_id()));--> statement-breakpoint
ALTER POLICY "companies_select_staff" ON "companies" TO authenticated USING ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "permissions_select_own_company" ON "permissions" TO authenticated USING ("permissions"."user_id" in (select id from "users" where company_id = (select public.current_company_id())));--> statement-breakpoint
ALTER POLICY "supplier_profiles_update_own" ON "supplier_profiles" TO authenticated USING ("supplier_profiles"."company_id" = (select public.current_company_id())) WITH CHECK ("supplier_profiles"."company_id" = (select public.current_company_id()));--> statement-breakpoint
ALTER POLICY "users_select_same_company" ON "users" TO authenticated USING ("users"."company_id" = (select public.current_company_id()));--> statement-breakpoint
ALTER POLICY "users_select_staff" ON "users" TO authenticated USING ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "extraction_aliases_select_staff" ON "extraction_aliases" TO authenticated USING ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "learning_events_select_staff" ON "learning_events" TO authenticated USING ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "model_snapshots_select_staff" ON "model_snapshots" TO authenticated USING ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "price_observations_select_staff" ON "price_observations" TO authenticated USING ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "ratings_select_staff" ON "ratings" TO authenticated USING ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "ratings_select_own_supplier" ON "ratings" TO authenticated USING ("ratings"."supplier_company_id" = (select public.current_company_id()));--> statement-breakpoint
ALTER POLICY "settings_select_staff" ON "settings" TO authenticated USING ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "time_entries_select_staff" ON "time_entries" TO authenticated USING ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "time_entries_insert_own" ON "time_entries" TO authenticated WITH CHECK ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "estimates_select_via_request" ON "estimates" TO authenticated USING ("estimates"."request_id" in (
    select id from "requests" where buyer_company_id = (select public.current_company_id())
  ) or (select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "estimates_insert_staff" ON "estimates" TO authenticated WITH CHECK ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "order_stage_events_insert_actor" ON "order_stage_events" TO authenticated WITH CHECK ("order_stage_events"."actor_user_id" = (select auth.uid()) and (
        (select public.current_role()) in ('concierge', 'admin')
        or "order_stage_events"."order_id" in (
          select o.id from "orders" o
          join "requests" r on r.id = o.request_id
          where r.buyer_company_id = (select public.current_company_id())
        )
      ));--> statement-breakpoint
ALTER POLICY "orders_select_via_request" ON "orders" TO authenticated USING ("orders"."request_id" in (
    select id from "requests" where buyer_company_id = (select public.current_company_id())
  ) or (select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "orders_select_supplier_in_plan" ON "orders" TO authenticated USING ("orders"."approved_plan_id" in (
        select plan_id from "plan_lines" where supplier_company_id = (select public.current_company_id())
      ));--> statement-breakpoint
ALTER POLICY "orders_insert_staff" ON "orders" TO authenticated WITH CHECK ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "orders_update_staff" ON "orders" TO authenticated USING ((select public.current_role()) in ('concierge', 'admin')) WITH CHECK ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "orders_update_buyer_own" ON "orders" TO authenticated USING ("orders"."request_id" in (
        select id from "requests" where buyer_company_id = (select public.current_company_id())
      )) WITH CHECK ("orders"."request_id" in (
        select id from "requests" where buyer_company_id = (select public.current_company_id())
      ));--> statement-breakpoint
ALTER POLICY "plan_lines_insert_staff" ON "plan_lines" TO authenticated WITH CHECK ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "plan_rejections_select_via_request" ON "plan_rejections" TO authenticated USING ("plan_rejections"."request_id" in (
    select id from "requests" where buyer_company_id = (select public.current_company_id())
  ) or (select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "plan_rejections_insert_staff" ON "plan_rejections" TO authenticated WITH CHECK ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "plans_select_via_request" ON "plans" TO authenticated USING ("plans"."request_id" in (
    select id from "requests" where buyer_company_id = (select public.current_company_id())
  ) or (select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "plans_insert_staff" ON "plans" TO authenticated WITH CHECK ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "plans_update_staff" ON "plans" TO authenticated USING ((select public.current_role()) in ('concierge', 'admin')) WITH CHECK ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "plans_update_buyer_own" ON "plans" TO authenticated USING ("plans"."request_id" in (
        select id from "requests" where buyer_company_id = (select public.current_company_id())
      )) WITH CHECK ("plans"."request_id" in (
        select id from "requests" where buyer_company_id = (select public.current_company_id())
      ));--> statement-breakpoint
ALTER POLICY "prepayments_select_via_request" ON "prepayments" TO authenticated USING ("prepayments"."request_id" in (
    select id from "requests" where buyer_company_id = (select public.current_company_id())
  ) or (select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "prepayments_insert_staff" ON "prepayments" TO authenticated WITH CHECK ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "quote_lines_select_own_supplier" ON "quote_lines" TO authenticated USING ("quote_lines"."quote_id" in (
        select id from "quotes" where rfq_id in (
          select id from "rfqs" where supplier_company_id = (select public.current_company_id())
        )
      ));--> statement-breakpoint
ALTER POLICY "quote_lines_select_buyer_of_request" ON "quote_lines" TO authenticated USING ("quote_lines"."quote_id" in (
        select id from "quotes" where rfq_id in (
          select id from "rfqs" where request_id in (
            select id from "requests" where buyer_company_id = (select public.current_company_id())
          )
        )
      ));--> statement-breakpoint
ALTER POLICY "quote_lines_select_staff" ON "quote_lines" TO authenticated USING ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "quote_lines_insert_own_supplier" ON "quote_lines" TO authenticated WITH CHECK ("quote_lines"."quote_id" in (
        select id from "quotes" where rfq_id in (
          select id from "rfqs" where supplier_company_id = (select public.current_company_id())
        )
      ));--> statement-breakpoint
ALTER POLICY "quotes_select_own_supplier" ON "quotes" TO authenticated USING ("quotes"."rfq_id" in (select id from "rfqs" where supplier_company_id = (select public.current_company_id())));--> statement-breakpoint
ALTER POLICY "quotes_select_buyer_of_request" ON "quotes" TO authenticated USING ("quotes"."rfq_id" in (
        select id from "rfqs" where request_id in (
          select id from "requests" where buyer_company_id = (select public.current_company_id())
        )
      ));--> statement-breakpoint
ALTER POLICY "quotes_select_staff" ON "quotes" TO authenticated USING ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "quotes_insert_own_supplier" ON "quotes" TO authenticated WITH CHECK ("quotes"."rfq_id" in (select id from "rfqs" where supplier_company_id = (select public.current_company_id())));--> statement-breakpoint
ALTER POLICY "request_items_select_via_request" ON "request_items" TO authenticated USING ("request_items"."request_id" in (
    select id from "requests" where buyer_company_id = (select public.current_company_id())
  ) or (select public.current_role()) in ('concierge', 'admin') or "request_items"."request_id" in (select public.rfq_request_ids_for_current_supplier()));--> statement-breakpoint
ALTER POLICY "request_items_insert_buyer_own" ON "request_items" TO authenticated WITH CHECK ("request_items"."request_id" in (
        select id from "requests" where buyer_company_id = (select public.current_company_id())
      ));--> statement-breakpoint
ALTER POLICY "requests_select_own_company" ON "requests" TO authenticated USING ("requests"."buyer_company_id" = (select public.current_company_id()));--> statement-breakpoint
ALTER POLICY "requests_select_staff" ON "requests" TO authenticated USING ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "requests_insert_own_company" ON "requests" TO authenticated WITH CHECK ("requests"."buyer_company_id" = (select public.current_company_id()));--> statement-breakpoint
ALTER POLICY "requests_update_staff" ON "requests" TO authenticated USING ((select public.current_role()) in ('concierge', 'admin')) WITH CHECK ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "rfqs_select_own_supplier" ON "rfqs" TO authenticated USING ("rfqs"."supplier_company_id" = (select public.current_company_id()));--> statement-breakpoint
ALTER POLICY "rfqs_select_buyer_of_request" ON "rfqs" TO authenticated USING ("rfqs"."request_id" in (select id from "requests" where buyer_company_id = (select public.current_company_id())));--> statement-breakpoint
ALTER POLICY "rfqs_select_staff" ON "rfqs" TO authenticated USING ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "rfqs_update_own_supplier" ON "rfqs" TO authenticated USING ("rfqs"."supplier_company_id" = (select public.current_company_id())) WITH CHECK ("rfqs"."supplier_company_id" = (select public.current_company_id()));--> statement-breakpoint
ALTER POLICY "rfqs_insert_staff" ON "rfqs" TO authenticated WITH CHECK ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "supplier_payouts_select_own_supplier" ON "supplier_payouts" TO authenticated USING ("supplier_payouts"."supplier_company_id" = (select public.current_company_id()));--> statement-breakpoint
ALTER POLICY "supplier_payouts_select_staff" ON "supplier_payouts" TO authenticated USING ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "supplier_payouts_insert_staff" ON "supplier_payouts" TO authenticated WITH CHECK ((select public.current_role()) in ('concierge', 'admin'));