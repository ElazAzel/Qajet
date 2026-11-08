-- Owner invites contain Auth credentials. Only admin and the worker may handle them.
-- Alter existing policies: another permissive policy would OR with the old access.
ALTER POLICY outbox_select_staff ON public.outbox TO authenticated
USING (
  (select public.current_role()) = 'admin'
  OR ((select public.current_role()) = 'concierge' AND kind <> 'company_owner_invite')
);
--> statement-breakpoint
ALTER POLICY outbox_insert_staff ON public.outbox TO authenticated
WITH CHECK (
  (select public.current_role()) = 'admin'
  OR ((select public.current_role()) = 'concierge' AND kind <> 'company_owner_invite')
);
--> statement-breakpoint
ALTER POLICY outbox_update_staff ON public.outbox TO authenticated
USING (
  (select public.current_role()) = 'admin'
  OR ((select public.current_role()) = 'concierge' AND kind <> 'company_owner_invite')
)
WITH CHECK (
  (select public.current_role()) = 'admin'
  OR ((select public.current_role()) = 'concierge' AND kind <> 'company_owner_invite')
);
