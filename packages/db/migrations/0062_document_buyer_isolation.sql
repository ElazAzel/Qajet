-- Order visibility is not document authorization: suppliers can read an order
-- they fulfil, but buyer invoices, acts and their metadata are not addressed to
-- them. supplier_invoice already was staff-only and has no supplier recipient
-- column, so order membership cannot safely grant access to that type either.
--
-- Preserve staff/service access and company-wide buyer owner/manager access.
-- An explicit buyer-type allowlist fails closed for future internal types.
-- current_role/current_company_id reject inactive profiles; company activity
-- must be checked separately, as in get_buyer_plans (0061).
-- Only SELECT changes. Document Engine INSERT and lifecycle RPCs are unchanged;
-- this does not establish the authenticity of caller-provided document JSON.
ALTER POLICY "documents_select_via_order" ON public.documents TO authenticated
USING (
  (SELECT public.current_role()) IN ('concierge', 'admin')
  OR (
    (SELECT public.current_role()) IN ('owner', 'manager')
    AND "documents"."type" IN (
      'prepay_invoice', 'act', 'final_invoice', 'refund_confirmation', 'spec'
    )
    AND "documents"."order_id" IN (
      SELECT o.id
      FROM public.orders o
      JOIN public.requests r ON r.id = o.request_id
      JOIN public.companies c ON c.id = r.buyer_company_id
      WHERE r.buyer_company_id = (SELECT public.current_company_id())
        AND c.type = 'buyer' AND c.is_active
    )
  )
);
