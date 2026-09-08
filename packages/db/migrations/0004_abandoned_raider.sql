ALTER POLICY "estimates_select_via_request" ON "estimates" TO authenticated USING ("estimates"."request_id" in (
    select id from "requests" where buyer_company_id = public.current_company_id()
  ) or public.current_role() in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "orders_select_via_request" ON "orders" TO authenticated USING ("orders"."request_id" in (
    select id from "requests" where buyer_company_id = public.current_company_id()
  ) or public.current_role() in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "plan_rejections_select_via_request" ON "plan_rejections" TO authenticated USING ("plan_rejections"."request_id" in (
    select id from "requests" where buyer_company_id = public.current_company_id()
  ) or public.current_role() in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "plans_select_via_request" ON "plans" TO authenticated USING ("plans"."request_id" in (
    select id from "requests" where buyer_company_id = public.current_company_id()
  ) or public.current_role() in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "prepayments_select_via_request" ON "prepayments" TO authenticated USING ("prepayments"."request_id" in (
    select id from "requests" where buyer_company_id = public.current_company_id()
  ) or public.current_role() in ('concierge', 'admin'));--> statement-breakpoint
ALTER POLICY "quote_lines_select_buyer_of_request" ON "quote_lines" TO authenticated USING ("quote_lines"."quote_id" in (
        select id from "quotes" where rfq_id in (
          select id from "rfqs" where request_id in (
            select id from "requests" where buyer_company_id = public.current_company_id()
          )
        )
      ));--> statement-breakpoint
ALTER POLICY "quotes_select_buyer_of_request" ON "quotes" TO authenticated USING ("quotes"."rfq_id" in (
        select id from "rfqs" where request_id in (
          select id from "requests" where buyer_company_id = public.current_company_id()
        )
      ));--> statement-breakpoint
ALTER POLICY "request_items_select_via_request" ON "request_items" TO authenticated USING ("request_items"."request_id" in (
    select id from "requests" where buyer_company_id = public.current_company_id()
  ) or public.current_role() in ('concierge', 'admin') or "request_items"."request_id" in (select public.rfq_request_ids_for_current_supplier()));--> statement-breakpoint
ALTER POLICY "rfqs_select_buyer_of_request" ON "rfqs" TO authenticated USING ("rfqs"."request_id" in (select id from "requests" where buyer_company_id = public.current_company_id()));