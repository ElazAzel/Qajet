DROP POLICY "plans_update_buyer_own" ON "plans" CASCADE;--> statement-breakpoint
-- Заменяет plans_update_buyer_own — та политика разрешала покупателю
-- UPDATE ЛЮБОЙ колонки на своём плане (RLS не умеет колоночно), хотя
-- approvePlan() в приложении трогает только status; прямой PostgREST-запрос
-- мог бы переписать commission_kzt/total_kzt/total_supplier_kzt (подмена
-- цены). SECURITY DEFINER (не INVOKER, как split_request_item/
-- merge_request_items — там INVOKER годился, потому что опирался на уже
-- существующие insert/delete policy с проверкой роли; здесь же смысл ровно
-- в том, чтобы у buyer НЕ было прямого UPDATE-доступа к plans вообще, а
-- проверку владения и сам UPDATE делала функция с повышенными правами)
-- — тот же приём, что current_company_id()/current_role() (0000-миграция).
CREATE OR REPLACE FUNCTION public.approve_plan(p_order_id uuid)
RETURNS public.plans
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_plan_id uuid;
  v_request_id uuid;
  v_updated public.plans;
BEGIN
  SELECT approved_plan_id, request_id INTO v_plan_id, v_request_id
  FROM public.orders WHERE id = p_order_id;

  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'approve_plan: заказ % не найден или у него нет плана', p_order_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.requests
    WHERE id = v_request_id AND buyer_company_id = public.current_company_id()
  ) THEN
    RAISE EXCEPTION 'approve_plan: доступно только покупателю этого заказа';
  END IF;

  UPDATE public.plans SET status = 'approved' WHERE id = v_plan_id
  RETURNING * INTO v_updated;

  RETURN v_updated;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.approve_plan(uuid) FROM public, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.approve_plan(uuid) TO authenticated, service_role;