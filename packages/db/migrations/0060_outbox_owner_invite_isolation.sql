-- Owner invitations contain bearer authentication links in body and payload.
-- Only active admins may read, create or change those rows through authenticated.
-- Concierge retains ordinary RFQ queue access. The server-side service_role
-- sender keeps its existing policy and worker RPCs; no delivery code changes.
-- ALTER the existing permissive policies: a second policy would OR with the
-- broad old staff grant. UPDATE needs both old-row USING and new-row WITH CHECK
-- to prevent redirecting/relabeling an invitation or promoting a routine row.
ALTER POLICY outbox_select_staff ON public.outbox
USING (
  (select public.current_role()) IN ('concierge', 'admin')
  AND (kind <> 'company_owner_invite' OR (select public.current_role()) = 'admin')
);
--> statement-breakpoint
ALTER POLICY outbox_insert_staff ON public.outbox
WITH CHECK (
  (select public.current_role()) IN ('concierge', 'admin')
  AND (kind <> 'company_owner_invite' OR (select public.current_role()) = 'admin')
);
--> statement-breakpoint
ALTER POLICY outbox_update_staff ON public.outbox
USING (
  (select public.current_role()) IN ('concierge', 'admin')
  AND (kind <> 'company_owner_invite' OR (select public.current_role()) = 'admin')
)
WITH CHECK (
  (select public.current_role()) IN ('concierge', 'admin')
  AND (kind <> 'company_owner_invite' OR (select public.current_role()) = 'admin')
);
