-- Fail closed when an authenticated identity has no active profile.
-- current_role() returns NULL for missing or inactive public.users rows.
-- In PL/pgSQL, IF NULL does not raise: NOT IN alone let those callers reach
-- this SECURITY DEFINER function's RFQ update and transactional outbox insert.
-- Preserve the existing workflow, idempotency, grants, and empty search_path.
-- PostgreSQL regression coverage: quote-revision-authorization.test.ts.
CREATE OR REPLACE FUNCTION public.request_supplier_quote_revision(
  p_rfq_id uuid,
  p_note text
) RETURNS public.rfqs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_rfq public.rfqs;
  v_note text := nullif(trim(p_note), '');
  v_next_version integer;
BEGIN
  IF auth.uid() IS NULL OR (public.current_role() IN ('concierge', 'admin')) IS NOT TRUE THEN
    RAISE EXCEPTION 'Запросить исправление КП может только сотрудник QAJET';
  END IF;
  IF v_note IS NULL OR length(v_note) < 5 OR length(v_note) > 2000 THEN
    RAISE EXCEPTION 'Причина исправления должна быть от 5 до 2000 символов';
  END IF;
  SELECT * INTO v_rfq FROM public.rfqs WHERE id = p_rfq_id FOR UPDATE;
  IF NOT FOUND OR v_rfq.status <> 'quoted' THEN
    RAISE EXCEPTION 'Исправление доступно только для уже отправленного КП';
  END IF;
  SELECT coalesce(max(version), 0) + 1 INTO v_next_version
  FROM public.quotes
  WHERE rfq_id = p_rfq_id;
  UPDATE public.rfqs
  SET revision_requested = true, revision_note = v_note, updated_at = now()
  WHERE id = p_rfq_id
  RETURNING * INTO v_rfq;

  INSERT INTO public.outbox(
    channel, kind, recipient, subject, body, payload, status, attempts, idempotency_key
  )
  SELECT
    'email',
    'rfq_revision_requested',
    u.email,
    'QAJET: требуется исправить КП',
    format(
      'Нужно исправить КП по RFQ %s: %s. Откройте рабочий кабинет поставщика.',
      p_rfq_id,
      v_note
    ),
    jsonb_build_object(
      'rfqId', p_rfq_id,
      'note', v_note,
      'quoteVersion', v_next_version
    ),
    'pending',
    0,
    format('rfq-revision:%s:%s:%s', p_rfq_id, v_next_version, u.id)
  FROM public.users u
  WHERE u.company_id = v_rfq.supplier_company_id
    AND u.is_active
    AND u.role IN ('owner', 'manager')
    AND (v_rfq.assigned_supplier_user_id IS NULL OR u.id = v_rfq.assigned_supplier_user_id)
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN v_rfq;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.request_supplier_quote_revision(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.request_supplier_quote_revision(uuid, text) TO authenticated;
