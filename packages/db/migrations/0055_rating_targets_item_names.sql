-- Покупатель должен видеть, ЧТО он оценивает.
-- Аудит UX: экран закрытого заказа просит поставить балл «Исполнителю 1» и
-- «Исполнителю 2», не говоря ни слова о том, что каждый из них вёз. Человек
-- ставит оценку вслепую, и она попадает в статистику поставщика и в подбор.
--
-- Показать НАЗВАНИЕ компании нельзя: QAJET — подрядчик покупателя и
-- рассчитывается с поставщиками сам, личности исполнителей закрыты (об этом
-- прямо сказано на том же экране). Поэтому исполнитель называется составом:
-- позициями заявки, которые он поставил.
--
-- Почему это делает функция, а не приложение: политики plan_lines открыты
-- только персоналу (plan_lines_select_via_plan) и самому поставщику
-- (plan_lines_select_own_supplier). Покупателю строки плана недоступны — так
-- скрыты и поставщики, и их цены. Эта SECURITY DEFINER функция уже проверяет
-- внутри тела, что вызывающий — активный владелец или менеджер компании-
-- покупателя и что заказ закрыт и принадлежит его компании; она и отдаёт ровно
-- то, что покупателю видеть можно.
--
-- Отдаются только названия позиций. Ни сумма строки плана, ни комиссия, ни имя
-- компании наружу не идут; это закреплено тестом
-- rating-targets-describe-items.test.ts («состав не раскрывает…»).
--
-- Тип результата меняется, поэтому нужен DROP: CREATE OR REPLACE не умеет
-- менять RETURNS TABLE. Вместе с функцией пропадают гранты — они выданы заново
-- ниже, теми же, что были (authenticated; anon и PUBLIC не получают ничего).
DROP FUNCTION IF EXISTS public.get_buyer_rating_targets(uuid);
--> statement-breakpoint

CREATE FUNCTION public.get_buyer_rating_targets(p_order_id uuid)
RETURNS TABLE(supplier_company_id uuid, rated boolean, item_names text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  SELECT u.company_id INTO v_company_id
  FROM public.users u
  JOIN public.companies c ON c.id = u.company_id
  WHERE u.id = auth.uid()
    AND u.is_active
    AND u.role IN ('owner', 'manager')
    AND c.type = 'buyer'
    AND c.is_active;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Только активный пользователь компании-покупателя может видеть оценки';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.requests r ON r.id = o.request_id
    WHERE o.id = p_order_id
      AND o.state = 'closed'
      AND r.buyer_company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'Оценка доступна только по закрытому заказу своей компании';
  END IF;

  RETURN QUERY
  SELECT
    pl.supplier_company_id,
    EXISTS (
      SELECT 1 FROM public.ratings rating
      WHERE rating.order_id = p_order_id
        AND rating.supplier_company_id = pl.supplier_company_id
    ) AS rated,
    -- Упорядочено по названию: порядок строк плана человеку ничего не говорит,
    -- а стабильный список читается и сравнивается между заходами.
    array_agg(DISTINCT ri.name ORDER BY ri.name) AS item_names
  FROM public.orders o
  JOIN public.plan_lines pl ON pl.plan_id = o.approved_plan_id
  JOIN public.request_items ri ON ri.id = pl.request_item_id
  WHERE o.id = p_order_id
  GROUP BY pl.supplier_company_id;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.get_buyer_rating_targets(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.get_buyer_rating_targets(uuid) TO authenticated;
