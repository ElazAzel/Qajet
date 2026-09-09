CREATE POLICY "request_items_insert_staff" ON "request_items" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
CREATE POLICY "request_items_delete_staff" ON "request_items" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_role()) in ('concierge', 'admin'));--> statement-breakpoint
-- Dependency Engine (agents.md §8A, волна 1 шаг 6). SECURITY INVOKER, не
-- DEFINER: выполняются от имени вызывающего, RLS-политики на
-- request_items продолжают действовать как реальная граница на insert/
-- delete. Но buyer у request_items_insert_buyer_own и так может вставлять
-- строки в СВОЮ заявку (мастер заявки строит её этим же путём) — без
-- явной проверки роли здесь buyer, вызвав эту функцию напрямую мимо
-- приложения, получил бы наполовину сработавший split: новые строки
-- вставились бы (insert его же заявки разрешён), а удаление исходной —
-- нет (delete только staff), оставляя дубликаты. Явная проверка роли
-- первой строкой — второй, независимый барьер поверх RLS (тот же приём,
-- что enforce_order_transition в 0001_pale_lockjaw.sql), а не замена ей:
-- она гарантирует, что функция либо отрабатывает целиком, либо не делает
-- ничего. Допустимость операции по стадии заказа (ITEMS_EDITABLE_STATES)
-- по-прежнему проверяется в приложении, не здесь — тем же приёмом, что
-- уже применён к request_items_update_staff.
CREATE OR REPLACE FUNCTION public.split_request_item(p_item_id uuid, p_parts jsonb)
RETURNS SETOF public.request_items
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_original public.request_items;
  v_part jsonb;
  v_new_row public.request_items;
BEGIN
  IF (select public.current_role()) not in ('concierge', 'admin') THEN
    RAISE EXCEPTION 'split_request_item: доступно только консьержу и админу';
  END IF;

  SELECT * INTO v_original FROM public.request_items WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'split_request_item: позиция % не найдена', p_item_id;
  END IF;

  IF jsonb_typeof(p_parts) <> 'array' OR jsonb_array_length(p_parts) < 2 THEN
    RAISE EXCEPTION 'split_request_item: нужно минимум 2 части';
  END IF;

  FOR v_part IN SELECT * FROM jsonb_array_elements(p_parts)
  LOOP
    IF coalesce((v_part->>'qty')::int, 0) <= 0 THEN
      RAISE EXCEPTION 'split_request_item: количество каждой части должно быть больше 0';
    END IF;

    INSERT INTO public.request_items (
      request_id, name, category, qty, unit, specs, required_capabilities,
      needs_clarification, clarification_reason
    ) VALUES (
      v_original.request_id,
      coalesce(nullif(v_part->>'name', ''), v_original.name),
      coalesce(nullif(v_part->>'category', ''), v_original.category),
      (v_part->>'qty')::int,
      v_original.unit,
      v_original.specs,
      v_original.required_capabilities,
      true,
      'Создано разделением позиции — требуется подтверждение категории и количества'
    )
    RETURNING * INTO v_new_row;

    RETURN NEXT v_new_row;
  END LOOP;

  DELETE FROM public.request_items WHERE id = p_item_id;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.merge_request_items(p_item_ids uuid[], p_name text DEFAULT NULL, p_category text DEFAULT NULL)
RETURNS public.request_items
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_first public.request_items;
  v_distinct_requests int;
  v_total_qty int;
  v_new_row public.request_items;
BEGIN
  IF (select public.current_role()) not in ('concierge', 'admin') THEN
    RAISE EXCEPTION 'merge_request_items: доступно только консьержу и админу';
  END IF;

  IF array_length(p_item_ids, 1) IS NULL OR array_length(p_item_ids, 1) < 2 THEN
    RAISE EXCEPTION 'merge_request_items: нужно минимум 2 позиции для объединения';
  END IF;

  SELECT count(DISTINCT request_id) INTO v_distinct_requests
    FROM public.request_items WHERE id = ANY(p_item_ids);
  IF v_distinct_requests <> 1 THEN
    RAISE EXCEPTION 'merge_request_items: все позиции должны принадлежать одной заявке';
  END IF;

  SELECT * INTO v_first FROM public.request_items WHERE id = p_item_ids[1];
  IF NOT FOUND THEN
    RAISE EXCEPTION 'merge_request_items: позиция % не найдена', p_item_ids[1];
  END IF;

  SELECT sum(qty) INTO v_total_qty FROM public.request_items WHERE id = ANY(p_item_ids);

  INSERT INTO public.request_items (
    request_id, name, category, qty, unit, specs, required_capabilities,
    needs_clarification, clarification_reason
  ) VALUES (
    v_first.request_id,
    coalesce(nullif(p_name, ''), v_first.name),
    coalesce(nullif(p_category, ''), v_first.category),
    v_total_qty,
    v_first.unit,
    v_first.specs,
    v_first.required_capabilities,
    true,
    'Создано объединением позиций — требуется подтверждение категории и количества'
  )
  RETURNING * INTO v_new_row;

  DELETE FROM public.request_items WHERE id = ANY(p_item_ids);

  RETURN v_new_row;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.split_request_item(uuid, jsonb) FROM public, anon;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.merge_request_items(uuid[], text, text) FROM public, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.split_request_item(uuid, jsonb) TO authenticated, service_role;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.merge_request_items(uuid[], text, text) TO authenticated, service_role;