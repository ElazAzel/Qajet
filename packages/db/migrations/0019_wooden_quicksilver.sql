-- Лимит согласования и право `can_approve_plan` стали редактируемыми на
-- экране «Команда и доступы» (§10), но ничто их не проверяло: approve_plan()
-- смотрела только на принадлежность заказа компании покупателя. То есть
-- экран обещал денежную границу полномочий, которой в системе не было —
-- менеджер с отозванным правом или с лимитом 800 000 ₸ утверждал план на
-- любую сумму. Найдено в code review PR #13.
--
-- Проверка живёт в RPC, а не только в server action: смысл всей замены
-- plans_update_buyer_own на SECURITY DEFINER-функцию (0013) был в том, что
-- прямой PostgREST-запрос мимо приложения не должен обходить правило.
--
-- Семантика прав: строка в `permissions` — это явная выдача или отзыв.
-- Отсутствие строки не запрещает (у владельца компании их может не быть
-- вовсе); запрещает только явное value = false. Лимит NULL = без лимита.
CREATE OR REPLACE FUNCTION public.approve_plan(p_order_id uuid)
RETURNS public.plans
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_plan_id uuid;
  v_request_id uuid;
  v_user_id uuid := (SELECT auth.uid());
  v_limit bigint;
  v_total bigint;
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

  IF EXISTS (
    SELECT 1 FROM public.permissions
    WHERE user_id = v_user_id AND key = 'can_approve_plan' AND value <> 'true'::jsonb
  ) THEN
    RAISE EXCEPTION 'approve_plan: у пользователя отозвано право утверждать планы';
  END IF;

  SELECT approval_limit_kzt INTO v_limit FROM public.users WHERE id = v_user_id;
  SELECT total_kzt INTO v_total FROM public.plans WHERE id = v_plan_id;

  IF v_limit IS NOT NULL AND v_total > v_limit THEN
    RAISE EXCEPTION 'approve_plan: сумма плана % превышает лимит согласования %', v_total, v_limit;
  END IF;

  UPDATE public.plans SET status = 'approved' WHERE id = v_plan_id
  RETURNING * INTO v_updated;

  RETURN v_updated;
END;
$$;
