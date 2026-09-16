-- agents.md §10 «Поставщик → статусы, которые он подтверждает сам». До сих
-- пор ВСЕ операционные стадии двигал только консьерж: «взял в
-- производство» и «отгрузил» попадали в систему пересказом и с задержкой,
-- хотя первым о них узнаёт поставщик.
--
-- Права на UPDATE orders поставщику при этом не выдаётся. RLS не умеет
-- ограничивать ни колонку, ни целевое значение: политика «поставщик может
-- UPDATE своих заказов» позволила бы ему выставить любое состояние, до
-- которого из текущего есть ребро в графе (включая cancelled). Поэтому —
-- SECURITY DEFINER-функция с явной проверкой, тот же приём, что
-- approve_plan() для покупателя (0013_blushing_tinkerer.sql).
--
-- Пары состояний продублированы здесь намеренно: это второй, независимый
-- барьер. Источник истины для графа — packages/engine/src/order/transition.ts.
CREATE OR REPLACE FUNCTION public.supplier_confirm_stage(p_order_id uuid, p_to_state text)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_state text;
  v_plan_id uuid;
  v_company uuid := public.current_company_id();
  v_updated public.orders;
BEGIN
  SELECT state::text, approved_plan_id INTO v_state, v_plan_id
  FROM public.orders WHERE id = p_order_id;

  IF v_state IS NULL THEN
    RAISE EXCEPTION 'supplier_confirm_stage: заказ % не найден', p_order_id;
  END IF;

  -- Поставщик обязан быть в утверждённом плане этого заказа. Строк плана
  -- он не видит (plan_lines закрыты до staff, ADR-0009) — проверка идёт
  -- здесь, под правами определившего.
  IF v_plan_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.plan_lines
    WHERE plan_id = v_plan_id AND supplier_company_id = v_company
  ) THEN
    RAISE EXCEPTION 'supplier_confirm_stage: заказ не ваш';
  END IF;

  IF (v_state, p_to_state) NOT IN (
    ('suppliers_paid', 'in_production'),
    ('in_production', 'shipped')
  ) THEN
    RAISE EXCEPTION 'supplier_confirm_stage: поставщик не подтверждает переход % → %', v_state, p_to_state;
  END IF;

  UPDATE public.orders SET state = p_to_state::public.order_state WHERE id = p_order_id
  RETURNING * INTO v_updated;

  -- Событие пишет сама функция, а не вызывающий код: политика
  -- order_stage_events_insert_actor не пускает поставщика, и расширять её
  -- значило бы дать ему писать в таймлайн любые события по своему заказу.
  -- Здесь же запись идёт ровно об одном совершившемся переходе.
  INSERT INTO public.order_stage_events (order_id, from_state, to_state, actor_user_id, note)
  VALUES (
    p_order_id,
    v_state::public.order_state,
    p_to_state::public.order_state,
    (SELECT auth.uid()),
    'Подтверждено поставщиком'
  );

  RETURN v_updated;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.supplier_confirm_stage(uuid, text) FROM public, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.supplier_confirm_stage(uuid, text) TO authenticated, service_role;--> statement-breakpoint
-- Третий раз подряд anon получает обратно EXECUTE на set_team_member_access
-- после apply_migration к НЕСВЯЗАННОЙ функции (эта миграция её не трогает).
-- Похоже, применение любой миграции к проекту Supabase сбрасывает права
-- выполнения на public-функциях к дефолтным ACL схемы (anon получает
-- EXECUTE на всё). Первопричина — в конфигурации проекта, не в этом коде;
-- пока она не найдена, каждая миграция, трогающая public-функции, обязана
-- заканчиваться этим REVOKE.
REVOKE EXECUTE ON FUNCTION public.set_team_member_access(uuid, bigint, boolean) FROM anon;
