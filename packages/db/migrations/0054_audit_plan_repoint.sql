-- Смена выбранного варианта плана оставляет запись в аудите.
-- Находка P3 из обзора базы; она стала заметна из-за миграции 0051, которая
-- разрешила покупателю переключаться между предложенными вариантами.
--
-- Проблема. audit_order_stage_transition (0038) выходит сразу, если состояние
-- заказа не изменилось: `IF OLD.state = NEW.state THEN RETURN NEW`. А
-- select_order_plan и прямая правка указателя меняют approved_plan_id, не меняя
-- стадию. В результате на вопрос «какой вариант покупатель выбрал и когда»
-- ответа в базе нет вообще, хотя это решение с денежными последствиями:
-- варианты отличаются суммой, сроком и составом поставщиков.
--
-- Исправление: отдельный триггер на UPDATE OF approved_plan_id, который пишет
-- строку в order_stage_events, когда указатель изменился, А СТАДИЯ — НЕТ.
-- Если изменились обе, запись уже делает существующий триггер (он включает в
-- заметку версию плана), и вторая строка была бы дублем.
--
-- from_state = to_state = текущая стадия: это не переход, а решение внутри
-- стадии. Колонка to_state объявлена NOT NULL, поэтому «пустого» перехода
-- записать нельзя, и одинаковые значения — честное описание происшедшего.
--
-- Автор берётся из auth.uid(). Если его нет (служебная роль, сев данных,
-- миграции), запись пропускается: actor_user_id объявлен NOT NULL со ссылкой
-- на users, и выдумывать автора нельзя. Исключение здесь бросать тоже нельзя —
-- это сломало бы служебные пути, которые к аудиту покупателя отношения не имеют.
CREATE OR REPLACE FUNCTION public.audit_order_plan_repoint()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old_kind text;
  v_new_kind text;
  v_old_total bigint;
  v_new_total bigint;
BEGIN
  IF NEW.approved_plan_id IS NOT DISTINCT FROM OLD.approved_plan_id THEN
    RETURN NEW;
  END IF;
  -- Смена вместе со стадией уже записана audit_order_stage_transition.
  IF OLD.state IS DISTINCT FROM NEW.state THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  SELECT kind::text, total_kzt INTO v_old_kind, v_old_total
  FROM public.plans WHERE id = OLD.approved_plan_id;
  SELECT kind::text, total_kzt INTO v_new_kind, v_new_total
  FROM public.plans WHERE id = NEW.approved_plan_id;

  INSERT INTO public.order_stage_events(order_id, from_state, to_state, actor_user_id, note)
  VALUES (
    NEW.id,
    OLD.state,
    NEW.state,
    auth.uid(),
    format(
      'Выбран другой вариант плана: %s → %s',
      coalesce(
        format('%s (%s ₸, %s)', v_old_kind, v_old_total, OLD.approved_plan_id),
        'не выбран'
      ),
      coalesce(
        format('%s (%s ₸, %s)', v_new_kind, v_new_total, NEW.approved_plan_id),
        'не выбран'
      )
    )
  );
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- 0043 выдаёт EXECUTE роли authenticated каждой НОВОЙ функции по умолчанию, а
-- 0052 отозвал это у всех существующих триггерных функций. Новая функция
-- обязана отозвать права явно, иначе инвариант «anon и authenticated не
-- исполняют ничего лишнего» снова перестанет выполняться.
-- Это проверяет function-privileges.test.ts (случай про все триггерные функции).
REVOKE ALL ON FUNCTION public.audit_order_plan_repoint() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

DROP TRIGGER IF EXISTS orders_audit_plan_repoint ON public.orders;
CREATE TRIGGER orders_audit_plan_repoint
AFTER UPDATE OF approved_plan_id ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.audit_order_plan_repoint();
