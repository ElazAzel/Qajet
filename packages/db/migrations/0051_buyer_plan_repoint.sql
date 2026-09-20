-- Покупатель не мог выбрать другой вариант плана — qajet-master-spec.md §6.
-- Воспроизведено packages/db/src/__tests__/privileged-rpc-authorization.test.ts
-- (2 из 42 падали: select_order_plan и допустимая прямая правка указателя).
--
-- select_order_plan (0037) обновляет orders.approved_plan_id от имени покупателя,
-- но guard_order_actor с 0020 по 0041 включительно разрешал покупателю менять
-- только state и поля закрытия. Внутри SECURITY DEFINER current_setting('role')
-- остаётся 'authenticated', поэтому сторож видел прямую правку покупателя и
-- отвечал «Покупатель не может менять внутренние поля заказа»: RPC не работала
-- ни разу, а тестировался только грант EXECUTE. Кнопка «выбрать вариант» в
-- buyer/orders/[id]/_plan-alternatives.tsx получала общий отказ с supportId.
--
-- Исправление в сторожа, а не флагом сессии (как qajet.stage_reason в 0038): тот
-- флаг несёт лишь текст причины, а здесь он давал бы привилегию, и его подделал
-- бы любой, кто выполняет SQL. Теперь инвариант лежит в самой БД: покупатель
-- перенаправляет approved_plan_id только до утверждения, на plan со статусом
-- proposed ТОЙ ЖЕ заявки, без смены стадии и без других изменений. Так же
-- ограничена и прямая правка: RPC остаётся удобным путём с проверкой ожидаемой
-- версии, но не единственным барьером.
--
-- Что не меняется: у сотрудника и поставщика права те же, чужой заказ по-прежнему
-- недоступен (orders_update_buyer_own), утверждение по-прежнему идёт через
-- approve_plan. Права EXECUTE не трогаются: CREATE OR REPLACE их сохраняет.
CREATE OR REPLACE FUNCTION public.guard_order_actor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $$
DECLARE
  v_role public.user_role;
  v_buyer boolean;
  v_supplier boolean;
  v_limit bigint;
  v_plan public.plans;
  v_repoint boolean;
  v_free text[];
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

  -- Покупатель может перенаправить указатель плана (select_order_plan), и только
  -- так: до утверждения, на предложенный план ТОЙ ЖЕ заявки, без смены стадии.
  -- Условие лежит здесь, а не во флаге сессии: флаг, выставляемый RPC, подделал бы
  -- любой, кто умеет выполнить SQL, а инвариант в самом сторожа подделать нельзя.
  v_repoint := v_buyer
    AND OLD.state = NEW.state
    AND OLD.state IN ('plan_proposed', 'awaiting_internal_approval')
    AND NEW.approved_plan_id IS DISTINCT FROM OLD.approved_plan_id
    AND EXISTS (
      SELECT 1 FROM public.plans p
      WHERE p.id = NEW.approved_plan_id
        AND p.request_id = OLD.request_id
        AND p.status = 'proposed'
    );
  v_free := CASE WHEN v_repoint THEN ARRAY['approved_plan_id'] ELSE ARRAY[]::text[] END;
  IF NEW.request_id IS DISTINCT FROM OLD.request_id THEN
    RAISE EXCEPTION 'Нельзя заменить заявку заказа';
  END IF;
  IF v_supplier AND (to_jsonb(NEW) - ARRAY['state', 'updated_at']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['state', 'updated_at']) THEN
    RAISE EXCEPTION 'Поставщик может только подтвердить доставку';
  END IF;
  IF v_buyer AND (to_jsonb(NEW) - (ARRAY['state', 'accepted_at', 'closed_at', 'settlement',
    'settlement_amount_kzt', 'final_cost_kzt', 'updated_at'] || v_free)) IS DISTINCT FROM
    (to_jsonb(OLD) - (ARRAY['state', 'accepted_at', 'closed_at', 'settlement',
    'settlement_amount_kzt', 'final_cost_kzt', 'updated_at'] || v_free)) THEN
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
    IF v_buyer AND (to_jsonb(NEW) - (ARRAY['updated_at'] || v_free))
      IS DISTINCT FROM (to_jsonb(OLD) - (ARRAY['updated_at'] || v_free)) THEN
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
$$;
