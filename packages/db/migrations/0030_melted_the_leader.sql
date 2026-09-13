DROP POLICY "attachments_insert_authenticated" ON "attachments" CASCADE;--> statement-breakpoint
CREATE POLICY "attachments_insert_buyer" ON "attachments" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("attachments"."uploaded_by" = (select auth.uid()) and exists (
        select 1 from "companies" c where c.id = (select public.current_company_id()) and c.type = 'buyer'
      ) and (
        "attachments"."request_id" in (select id from "requests") or
        "attachments"."order_id" in (select id from "orders") or
        "attachments"."thread_id" in (select id from "threads" where kind = 'buyer') or
        "attachments"."message_id" in (select m.id from "messages" m join "threads" th on th.id = m.thread_id where th.kind = 'buyer')
      ));--> statement-breakpoint
CREATE POLICY "attachments_insert_supplier" ON "attachments" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("attachments"."uploaded_by" = (select auth.uid()) and (select public.current_role()) in ('owner', 'manager') and (
        "attachments"."thread_id" in (select id from "threads" where kind = 'supplier' and supplier_company_id = (select public.current_company_id())) or
        "attachments"."message_id" in (select m.id from "messages" m join "threads" th on th.id = m.thread_id where th.kind = 'supplier' and th.supplier_company_id = (select public.current_company_id())) or
        "attachments"."order_id" in (select o.id from "orders" o join "plan_lines" pl on pl.plan_id = o.approved_plan_id where pl.supplier_company_id = (select public.current_company_id()))
      ));