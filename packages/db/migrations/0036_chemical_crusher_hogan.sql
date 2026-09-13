ALTER POLICY "attachments_select_supplier" ON "attachments" TO authenticated USING ((
        "attachments"."thread_id" in (select id from "threads" where kind = 'supplier' and supplier_company_id = (select public.current_company_id())) or
        "attachments"."message_id" in (select m.id from "messages" m join "threads" th on th.id = m.thread_id where th.kind = 'supplier' and th.supplier_company_id = (select public.current_company_id())) or
        ("attachments"."order_id" is not null and public.supplier_can_access_order("attachments"."order_id"))
      ));--> statement-breakpoint
ALTER POLICY "attachments_insert_supplier" ON "attachments" TO authenticated WITH CHECK ("attachments"."uploaded_by" = (select auth.uid()) and (select public.current_role()) in ('owner', 'manager') and (
        "attachments"."thread_id" in (select id from "threads" where kind = 'supplier' and supplier_company_id = (select public.current_company_id())) or
        "attachments"."message_id" in (select m.id from "messages" m join "threads" th on th.id = m.thread_id where th.kind = 'supplier' and th.supplier_company_id = (select public.current_company_id())) or
        ("attachments"."order_id" is not null and public.supplier_can_access_order("attachments"."order_id"))
      ));