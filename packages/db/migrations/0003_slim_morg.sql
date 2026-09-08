CREATE OR REPLACE FUNCTION public.rfq_request_ids_for_current_supplier()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT request_id FROM public.rfqs WHERE supplier_company_id = public.current_company_id()
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.buyer_company_ids_for_current_supplier()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT r.buyer_company_id FROM public.requests r
  JOIN public.rfqs rf ON rf.request_id = r.id
  WHERE rf.supplier_company_id = public.current_company_id()
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.rfq_request_ids_for_current_supplier() FROM public, anon;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.buyer_company_ids_for_current_supplier() FROM public, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.rfq_request_ids_for_current_supplier() TO authenticated, service_role;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.buyer_company_ids_for_current_supplier() TO authenticated, service_role;--> statement-breakpoint
ALTER POLICY "companies_select_supplier_via_rfq" ON "companies" TO authenticated USING (id in (select public.buyer_company_ids_for_current_supplier()));--> statement-breakpoint
ALTER POLICY "requests_select_supplier_via_rfq" ON "requests" TO authenticated USING ("requests"."id" in (select public.rfq_request_ids_for_current_supplier()));
