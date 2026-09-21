-- Триггерные функции не должны исполняться через API — AGENTS.md, «Privileged access»:
-- каждой функции нужны ограничивающие гранты. Воспроизведено function-privileges.test.ts (1 из 6 падал).
--
-- Проблема. 0042 обходил только SECURITY DEFINER-функции (WHERE p.prosecdef),
-- поэтому пять триггерных функций SECURITY INVOKER сохранили выданные при
-- создании EXECUTE для anon и authenticated: enforce_approved_plan_immutable,
-- enforce_approved_plan_lines_immutable, guard_quote_line, guard_supplier_quote,
-- guard_supplier_rfq. А 0043 выдаёт EXECUTE роли authenticated каждой НОВОЙ
-- функции по умолчанию, так что следующая триггерная функция повторила бы это.
-- Тест 0042 фильтровал тем же prosecdef и слепоты не видел.
--
-- Опасность невелика: прямой вызов такой функции даёт «trigger functions can
-- only be called as triggers», а PostgREST триггерные функции не публикует. Но
-- заявленный инвариант — «anon и authenticated не исполняют ничего лишнего» —
-- не выполнялся, и держался он только на том, что никто не проверял.
--
-- Исправление: тот же REVOKE, но для ВСЕХ триггерных функций public, а не по
-- списку имён. Триггеру право EXECUTE при срабатывании не нужно: оно проверяется
-- один раз, при CREATE TRIGGER, у того, кто его создаёт. Это подтверждают 33
-- SECURITY DEFINER-триггера, для которых REVOKE уже действует и которые
-- работают. Функция-триггер SECURITY INVOKER выполняется правами того, кто
-- изменил строку, — это не меняется.
--
-- Будущие триггерные функции ловит function-privileges.test.ts: он смотрит на
-- все триггерные функции, а не только на SECURITY DEFINER.
DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.prorettype = 'trigger'::regtype
      AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.signature);
  END LOOP;
END
$$;
