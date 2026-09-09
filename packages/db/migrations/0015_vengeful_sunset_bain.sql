CREATE POLICY "model_snapshots_insert_staff" ON "model_snapshots" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "settings_select_public_requisites" ON "settings" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("settings"."key" = 'qajet_requisites');--> statement-breakpoint
CREATE POLICY "documents_insert_via_order" ON "documents" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("documents"."order_id" in (
        select o.id from "orders" o
        join "requests" r on r.id = o.request_id
        where (select public.current_role()) in ('concierge', 'admin') or r.buyer_company_id = (select public.current_company_id())
      ));