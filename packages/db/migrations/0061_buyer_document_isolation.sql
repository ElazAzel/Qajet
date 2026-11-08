-- Visibility of an order to its supplier does not authorize buyer-facing documents.
-- Internal supplier invoices remain staff-only; worker access is unchanged.
ALTER POLICY documents_select_via_order ON public.documents TO authenticated
USING (
  (select public.current_role()) IN ('concierge', 'admin')
  OR (
    type <> 'supplier_invoice'
    AND order_id IN (
      SELECT o.id FROM public.orders o
      JOIN public.requests r ON r.id = o.request_id
      WHERE r.buyer_company_id = (select public.current_company_id())
    )
  )
);
