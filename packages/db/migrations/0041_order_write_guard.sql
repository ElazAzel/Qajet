-- Защита записи в orders и подтверждения доставки — qajet-master-spec.md §6, §3.4.
-- Воспроизведено packages/db/src/__tests__/order-write-guard.test.ts (4 из 4 падали).
--
-- 1. guard_order_actor: сотрудник мог прямым PATCH переписать сверку и даты,
--    если состояние не менялось (проверка выходила при OLD.state = NEW.state),
--    а аудит висит на UPDATE OF state — следа не оставалось. Теперь у
--    сотрудника закрыт список колонок, закрытый и отменённый заказ
--    неизменяемы, а accepted_at и closed_at принимаются только около now().
-- 2. confirm_supplier_delivery проверял компанию, а не назначенного
--    пользователя, и обходил supplier_can_access_order (SECURITY DEFINER
--    отключал RLS соседних политик). Теперь тот же предикат, что у них.
CREATE OR REPLACE FUNCTION public.guard_order_actor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_role public.user_role;
  v_buyer boolean;
  v_supplier boolean;
  v_limit bigint;
  v_plan public.plans;
BEGIN
  IF current_setting('role', true) NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  SELECT u.role, u.approval_limit_kzt INTO v_role, v_limit
  FROM public.users u WHERE u.id = auth.uid() AND u.is_active;
  IF v_role IS NULL THEN RAISE EXCEPTION 'Профиль недоступен'; END IF;

  v_buyer := v_role IN ('owner', 'manager') AND EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.companies c ON c.id = u.company_id
    JOIN public.requests r ON r.buyer_company_id = c.id
    WHERE u.id = auth.uid() AND c.type = 'buyer' AND c.is_active AND r.id = OLD.request_id
  );
  v_supplier := v_role IN ('owner', 'manager') AND EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.companies c ON c.id = u.company_id
    JOIN public.plan_lines pl ON pl.supplier_company_id = c.id
    WHERE u.id = auth.uid() AND c.type = 'supplier' AND c.is_active AND pl.plan_id = OLD.approved_plan_id
  );

  IF NEW.request_id IS DISTINCT FROM OLD.request_id THEN
    RAISE EXCEPTION 'Нельзя заменить заявку заказа';
  END IF;
  IF v_supplier AND (to_jsonb(NEW) - ARRAY['state', 'updated_at']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['state', 'updated_at']) THEN
    RAISE EXCEPTION 'Поставщик может только подтвердить доставку';
  END IF;
  IF v_buyer AND (to_jsonb(NEW) - ARRAY['state', 'accepted_at', 'closed_at', 'settlement',
    'settlement_amount_kzt', 'final_cost_kzt', 'updated_at']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['state', 'accepted_at', 'closed_at', 'settlement',
    'settlement_amount_kzt', 'final_cost_kzt', 'updated_at']) THEN
    RAISE EXCEPTION 'Покупатель не может менять внутренние поля заказа';
  END IF;

  -- Закрытый и отменённый заказы неизменяемы для любой сессии PostgREST.
  IF OLD.state IN ('closed', 'cancelled')
    AND (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
    RAISE EXCEPTION 'Закрытый или отменённый заказ не меняется';
  END IF;

  -- Даты приёмки и закрытия проставляет система: покупатель и сотрудник не
  -- выбирают их сами, иначе можно подделать срок приёмки или закрытия.
  IF NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
    AND (NEW.accepted_at IS NULL OR abs(extract(epoch FROM (NEW.accepted_at - now()))) > 600) THEN
    RAISE EXCEPTION 'Дату приёмки проставляет система';
  END IF;
  IF NEW.closed_at IS DISTINCT FROM OLD.closed_at
    AND (NEW.closed_at IS NULL OR abs(extract(epoch FROM (NEW.closed_at - now()))) > 600) THEN
    RAISE EXCEPTION 'Дату закрытия проставляет система';
  END IF;

  -- Сотрудник может менять только то, что меняют RPC переходов и назначений.
  -- Раньше при OLD.state = NEW.state проверка выходила сразу, и любое поле
  -- (в том числе сверку) можно было переписать прямым PATCH без следа в аудите.
  IF v_role IN ('concierge', 'admin') THEN
    IF (to_jsonb(NEW) - ARRAY['state', 'updated_at', 'concierge_user_id', 'approved_plan_id',
        'accepted_at', 'closed_at', 'settlement', 'settlement_amount_kzt', 'final_cost_kzt'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state', 'updated_at', 'concierge_user_id', 'approved_plan_id',
        'accepted_at', 'closed_at', 'settlement', 'settlement_amount_kzt', 'final_cost_kzt']) THEN
      RAISE EXCEPTION 'Служебные поля заказа менять нельзя';
    END IF;
    IF OLD.state = NEW.state
      AND (to_jsonb(NEW) - ARRAY['updated_at', 'concierge_user_id', 'approved_plan_id'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['updated_at', 'concierge_user_id', 'approved_plan_id']) THEN
      RAISE EXCEPTION 'Сверка и даты заказа меняются только переходом стадии';
    END IF;
  END IF;

  IF OLD.state = NEW.state THEN
    IF v_buyer AND (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
      RAISE EXCEPTION 'Финансовые поля меняются только при завершении заказа';
    END IF;
    RETURN NEW;
  END IF;

  IF v_role IN ('concierge', 'admin') THEN
    IF OLD.state = 'shipped' AND NEW.state = 'delivered' THEN
      RAISE EXCEPTION 'Поставщик подтверждает доставку';
    ELSIF NEW.state IN ('plan_approved', 'awaiting_internal_approval')
      OR (OLD.state IN ('delivered', 'disputed') AND NEW.state = 'accepted') THEN
      RAISE EXCEPTION 'Этот переход выполняет другой участник процесса';
    END IF;
  ELSIF v_buyer THEN
    IF NOT ((OLD.state, NEW.state) IN (
      ('plan_proposed', 'plan_approved'),
      ('plan_proposed', 'awaiting_internal_approval'),
      ('awaiting_internal_approval', 'plan_approved'),
      ('rfq_sent', 'cancelled'),
      ('plan_proposed', 'cancelled'),
      ('awaiting_internal_approval', 'cancelled'),
      ('delivered', 'accepted'),
      ('delivered', 'disputed'),
      ('disputed', 'accepted'),
      ('accepted', 'closed')
    )) THEN
      RAISE EXCEPTION 'Покупатель не может выполнить этот переход';
    END IF;
  ELSIF v_supplier THEN
    IF (OLD.state, NEW.state) <> ('shipped', 'delivered') THEN
      RAISE EXCEPTION 'Поставщик может только подтвердить доставку';
    END IF;
  ELSE
    RAISE EXCEPTION 'Роль не может менять стадии заказа';
  END IF;

  SELECT * INTO v_plan FROM public.plans WHERE id = NEW.approved_plan_id;
  IF NEW.state = 'plan_approved' THEN
    IF EXISTS (SELECT 1 FROM public.permissions WHERE user_id = auth.uid()
      AND key = 'can_approve_plan' AND value <> 'true'::jsonb) THEN
      RAISE EXCEPTION 'Право утверждать планы отозвано';
    END IF;
    IF v_plan.status IS DISTINCT FROM 'approved' OR v_plan.request_id IS DISTINCT FROM NEW.request_id THEN
      RAISE EXCEPTION 'Сначала утвердите актуальный план';
    END IF;
    IF v_role = 'manager' AND v_plan.total_kzt > coalesce(v_limit, 0) THEN
      RAISE EXCEPTION 'Сумма превышает лимит менеджера';
    END IF;
  END IF;

  IF NEW.state IN ('suppliers_paid', 'in_production', 'shipped', 'delivered', 'accepted', 'closed') THEN
    IF v_plan.id IS NULL OR v_plan.status IS DISTINCT FROM 'approved'
      OR NOT EXISTS (SELECT 1 FROM public.plan_lines pl WHERE pl.plan_id = v_plan.id)
      OR EXISTS (
        SELECT 1 FROM (SELECT DISTINCT supplier_company_id FROM public.plan_lines WHERE plan_id = v_plan.id) required
        WHERE NOT EXISTS (
          SELECT 1 FROM public.supplier_payouts sp
          WHERE sp.order_id = NEW.id AND sp.supplier_company_id = required.supplier_company_id AND sp.status = 'paid'
        )
      ) THEN
      RAISE EXCEPTION 'До исполнения нужны утверждённый план и подтверждённые выплаты поставщикам';
    END IF;
  END IF;

  IF NEW.state = 'delivered' AND (
    NOT EXISTS (SELECT 1 FROM public.order_supplier_deliveries d
      WHERE d.order_id = NEW.id AND d.supplier_company_id = public.current_company_id())
    OR EXISTS (
      SELECT 1 FROM (SELECT DISTINCT supplier_company_id FROM public.plan_lines WHERE plan_id = v_plan.id) required
      WHERE NOT EXISTS (SELECT 1 FROM public.order_supplier_deliveries d
        WHERE d.order_id = NEW.id AND d.supplier_company_id = required.supplier_company_id)
    )
  ) THEN
    RAISE EXCEPTION 'Доставку должны подтвердить все поставщики плана';
  END IF;

  IF NEW.state = 'closed' THEN
    IF v_plan.id IS NULL OR NEW.settlement IS NULL OR NEW.settlement_amount_kzt IS NULL
      OR (NEW.settlement = 'refund' AND NEW.settlement_amount_kzt >= 0)
      OR (NEW.settlement = 'surcharge' AND NEW.settlement_amount_kzt <= 0)
      OR (NEW.settlement = 'exact' AND NEW.settlement_amount_kzt <> 0)
      OR NEW.final_cost_kzt IS DISTINCT FROM (v_plan.total_kzt + NEW.settlement_amount_kzt)
      OR NEW.final_cost_kzt < 0 THEN
      RAISE EXCEPTION 'Некорректные суммы сверки';
    END IF;
  ELSIF (NEW.settlement, NEW.settlement_amount_kzt, NEW.final_cost_kzt, NEW.closed_at)
    IS DISTINCT FROM (OLD.settlement, OLD.settlement_amount_kzt, OLD.final_cost_kzt, OLD.closed_at) THEN
    RAISE EXCEPTION 'Сверка доступна только при завершении заказа';
  END IF;
  RETURN NEW;
END;
$function$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.confirm_supplier_delivery(p_order_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user public.users;
  v_order public.orders;
  v_supplier uuid;
  v_required integer;
  v_confirmed integer;
  v_delivered boolean := false;
BEGIN
  SELECT * INTO v_user
  FROM public.users
  WHERE id = auth.uid() AND is_active;
  IF NOT FOUND OR v_user.role NOT IN ('owner', 'manager') OR NOT EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.id = v_user.company_id AND c.type = 'supplier' AND c.is_active
  ) THEN
    RAISE EXCEPTION 'Только активный пользователь компании-поставщика может подтвердить доставку';
  END IF;
  v_supplier := v_user.company_id;

  SELECT * INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
    AND EXISTS (
      SELECT 1 FROM public.plan_lines pl
      WHERE pl.plan_id = o.approved_plan_id AND pl.supplier_company_id = v_supplier
    )
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Заказ не назначен вашей компании';
  END IF;
  -- Тот же предикат, что у политик orders и order_supplier_deliveries: менеджер
  -- видит только заказы, назначенные ему; владелец компании — все её заказы.
  IF NOT public.supplier_can_access_order(p_order_id) THEN
    RAISE EXCEPTION 'Заказ не назначен вам';
  END IF;
  IF v_order.state = 'delivered' THEN
    RETURN true;
  END IF;
  IF v_order.state <> 'shipped' THEN
    RAISE EXCEPTION 'Подтвердить доставку можно только для отправленного заказа';
  END IF;

  INSERT INTO public.order_supplier_deliveries(order_id, supplier_company_id, confirmed_by)
    VALUES (p_order_id, v_supplier, auth.uid())
  ON CONFLICT (order_id, supplier_company_id) DO NOTHING;

  SELECT count(*)::integer INTO v_required
  FROM (SELECT DISTINCT supplier_company_id FROM public.plan_lines WHERE plan_id = v_order.approved_plan_id) required;
  SELECT count(*)::integer INTO v_confirmed
  FROM public.order_supplier_deliveries d
  WHERE d.order_id = p_order_id;
  IF v_required > 0 AND v_confirmed >= v_required THEN
    UPDATE public.orders SET state = 'delivered' WHERE id = p_order_id AND state = 'shipped';
    v_delivered := true;
  END IF;
  RETURN v_delivered;
END;
$function$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.confirm_supplier_delivery(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.confirm_supplier_delivery(uuid) TO authenticated;
