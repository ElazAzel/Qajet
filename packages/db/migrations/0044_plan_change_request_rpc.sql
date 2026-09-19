-- Запрос изменения утверждённого плана — один транзакционный RPC — G5/G6.
-- Раньше requestPlanChange делал пять последовательных запросов PostgREST:
-- проверка «нет pending» шла отдельным чтением (гонка двух вкладок давала два
-- pending-запроса), а результат вставки сообщения нигде не проверялся, так что
-- запрос мог существовать без сообщения покупателю.
--
-- Функция SECURITY INVOKER: доступ по-прежнему решает RLS покупателя, а не
-- привилегии владельца функции. Уникальный частичный индекс — окончательная
-- защита от гонки: вторая вставка падает на нём, а не на проверке в коде.
CREATE UNIQUE INDEX IF NOT EXISTS change_requests_one_pending_per_order
  ON public.change_requests (order_id) WHERE status = 'pending';--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.request_plan_change(
  p_order_id uuid,
  p_reason text,
  p_supplier_delta_kzt bigint,
  p_delivery_delta_kzt bigint
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders;
  v_plan public.plans;
  v_thread uuid;
  v_id uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Требуется вход';
  END IF;
  IF char_length(v_reason) < 5 OR char_length(v_reason) > 2000 THEN
    RAISE EXCEPTION 'Опишите изменение: от 5 до 2000 символов';
  END IF;
  IF abs(coalesce(p_supplier_delta_kzt, 0)) > 100000000 OR abs(coalesce(p_delivery_delta_kzt, 0)) > 100000000 THEN
    RAISE EXCEPTION 'Сумма изменения указана некорректно';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Заказ не найден или недоступен';
  END IF;
  IF v_order.approved_plan_id IS NULL THEN
    RAISE EXCEPTION 'У заказа нет утверждённого плана';
  END IF;
  IF v_order.state NOT IN ('plan_approved', 'on_hold') THEN
    RAISE EXCEPTION 'Изменение условий доступно до выплаты поставщикам';
  END IF;

  SELECT * INTO v_plan FROM public.plans WHERE id = v_order.approved_plan_id;
  IF NOT FOUND OR v_plan.status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'План уже изменён';
  END IF;

  BEGIN
    INSERT INTO public.change_requests (order_id, proposed_plan_id, initiator_user_id, diff, status)
    VALUES (
      p_order_id,
      v_plan.id,
      auth.uid(),
      jsonb_build_object(
        'reason', v_reason,
        'requestedSupplierDeltaKzt', coalesce(p_supplier_delta_kzt, 0),
        'requestedDeliveryDeltaKzt', coalesce(p_delivery_delta_kzt, 0),
        'expectedPlanId', v_plan.id,
        'expectedPlanVersion', v_plan.version
      ),
      'pending'
    )
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'По заказу уже есть запрос на рассмотрении';
  END;

  SELECT id INTO v_thread FROM public.threads WHERE order_id = p_order_id AND kind = 'buyer';
  IF v_thread IS NOT NULL THEN
    INSERT INTO public.messages (thread_id, author_user_id, body)
    VALUES (v_thread, auth.uid(), 'Запрос изменения условий: ' || v_reason);
  END IF;

  RETURN v_id;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.request_plan_change(uuid, text, bigint, bigint) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.request_plan_change(uuid, text, bigint, bigint) TO authenticated;--> statement-breakpoint

-- G8: отозванный владелец не должен управлять доступами команды. Сама функция
-- SECURITY DEFINER, поэтому неактивность вызывающего надо проверять явно.
CREATE OR REPLACE FUNCTION public.set_team_member_access(p_user_id uuid, p_approval_limit_kzt bigint, p_is_active boolean)
 RETURNS users
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_row public.users;
  v_caller public.users;
BEGIN
  SELECT * INTO v_caller FROM public.users WHERE id = (select auth.uid()) AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_team_member_access: вызывающий не найден';
  END IF;
  IF v_caller.role <> 'owner' THEN
    RAISE EXCEPTION 'set_team_member_access: доступно только владельцу компании';
  END IF;
  IF p_is_active IS NULL OR (p_approval_limit_kzt IS NOT NULL AND p_approval_limit_kzt < 0) THEN
    RAISE EXCEPTION 'set_team_member_access: некорректный лимит или статус';
  END IF;

  SELECT * INTO v_row FROM public.users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_team_member_access: сотрудник % не найден', p_user_id;
  END IF;
  IF v_row.company_id IS DISTINCT FROM v_caller.company_id THEN
    RAISE EXCEPTION 'set_team_member_access: сотрудник не из вашей компании';
  END IF;
  IF p_user_id = v_caller.id AND p_is_active = false THEN
    RAISE EXCEPTION 'set_team_member_access: нельзя отозвать доступ у самого себя';
  END IF;

  UPDATE public.users
  SET approval_limit_kzt = p_approval_limit_kzt,
      is_active = p_is_active,
      deactivated_at = CASE
        WHEN p_is_active THEN NULL
        ELSE COALESCE(deactivated_at, now())
      END,
      updated_at = now()
  WHERE id = p_user_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;--> statement-breakpoint

-- G17: хелперы RLS закреплены на пустой search_path. Тела уже полностью
-- квалифицированы (public.users, public.rfqs, auth.uid()), поведение не меняется.
ALTER FUNCTION public."current_role"() SET search_path = '';--> statement-breakpoint
ALTER FUNCTION public.current_company_id() SET search_path = '';--> statement-breakpoint
ALTER FUNCTION public.buyer_company_ids_for_current_supplier() SET search_path = '';--> statement-breakpoint
ALTER FUNCTION public.rfq_request_ids_for_current_supplier() SET search_path = '';
