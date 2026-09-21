-- Админ QAJET управляет учётными записями: блокировка и правка.
--
-- Было: на таблице users нет ни одной UPDATE-политики для authenticated, а
-- единственное админское действие — «создать компанию с владельцем» — ходит
-- сервисным клиентом с проверкой requireAdmin() в коде приложения. Завести
-- второго сотрудника, заблокировать уволенного или исправить роль было нельзя
-- ниоткуда.
--
-- Почему RPC, а не политика и не сервисный клиент. Смена роли и блокировка —
-- операции с повышением привилегий. Проверка внутри тела функции действует для
-- ЛЮБОГО вызывающего; проверка в коде приложения действует ровно до первого
-- пути, который её забудет. UPDATE-политику на users пришлось бы писать так,
-- чтобы она различала «кто меняет» и «что меняет» — в одном выражении это
-- нечитаемо и легко ослабляется правкой.
--
-- SECURITY DEFINER нужен потому, что менять чужие строки users не позволяет ни
-- одна политика, и выдавать такое право роли authenticated нельзя.
-- search_path пустой, все обращения квалифицированы схемой.
-- Права: только authenticated; PUBLIC и anon не получают ничего.
-- Тесты: packages/db/src/__tests__/admin-user-management.test.ts (16 случаев).
--
-- Три запрета — условия управляемости, а не украшения:
--   1. нельзя действовать на себя: иначе админ запирает сам себя одним кликом;
--   2. нельзя убрать последнего активного админа: система станет неуправляемой,
--      и починить это можно будет только руками в базе;
--   3. роль и компания согласованы: concierge и admin — персонал QAJET и живут
--      вне компаний, owner и manager — сотрудники компании. Рассогласование
--      ломает current_company_id() и половину политик.
--
-- Блокировка НЕ удаляет строку: agents.md требует сохранять авторов и отметки
-- времени при отзыве доступа. Выключается признак, история остаётся.

CREATE OR REPLACE FUNCTION public.admin_require_caller()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT u.id INTO v_id
  FROM public.users u
  WHERE u.id = auth.uid() AND u.is_active AND u.role = 'admin'::public.user_role;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Только активный админ QAJET может управлять учётными записями';
  END IF;
  RETURN v_id;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.admin_require_caller() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.admin_set_user_active(p_user_id uuid, p_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid;
  v_target public.users;
BEGIN
  v_caller := public.admin_require_caller();

  IF p_user_id = v_caller THEN
    RAISE EXCEPTION 'Нельзя заблокировать сам себя: попросите другого админа';
  END IF;

  SELECT * INTO v_target FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF v_target.id IS NULL THEN
    RAISE EXCEPTION 'Учётная запись не найдена';
  END IF;

  -- Последний активный админ. Считаем ПОСЛЕ блокировки строки, чтобы два
  -- одновременных вызова не сняли двух последних админов разом.
  IF p_active = false AND v_target.role = 'admin'::public.user_role THEN
    IF (
      SELECT count(*) FROM public.users
      WHERE role = 'admin'::public.user_role AND is_active AND id <> p_user_id
    ) = 0 THEN
      RAISE EXCEPTION 'Это последний активный админ: система останется без управления';
    END IF;
  END IF;

  UPDATE public.users
  SET is_active = p_active,
      deactivated_at = CASE WHEN p_active THEN NULL ELSE now() END,
      updated_at = now()
  WHERE id = p_user_id;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.admin_set_user_active(uuid, boolean) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.admin_set_user_active(uuid, boolean) TO authenticated;
--> statement-breakpoint

-- NULL в параметре означает «не менять это поле», а не «очистить».
CREATE OR REPLACE FUNCTION public.admin_update_user(
  p_user_id uuid,
  p_full_name text,
  p_role public.user_role
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid;
  v_target public.users;
  v_name text;
  v_role public.user_role;
BEGIN
  v_caller := public.admin_require_caller();

  SELECT * INTO v_target FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF v_target.id IS NULL THEN
    RAISE EXCEPTION 'Учётная запись не найдена';
  END IF;

  v_name := coalesce(nullif(trim(p_full_name), ''), v_target.full_name);
  v_role := coalesce(p_role, v_target.role);

  IF p_full_name IS NOT NULL AND nullif(trim(p_full_name), '') IS NULL THEN
    RAISE EXCEPTION 'Имя не может быть пустым';
  END IF;

  IF v_role IS DISTINCT FROM v_target.role THEN
    IF p_user_id = v_caller THEN
      RAISE EXCEPTION 'Нельзя менять роль сам себе: попросите другого админа';
    END IF;
    -- Персонал QAJET живёт вне компаний, сотрудники компании — внутри.
    IF v_role IN ('concierge'::public.user_role, 'admin'::public.user_role)
       AND v_target.company_id IS NOT NULL THEN
      RAISE EXCEPTION 'Сотрудник компании не может стать персоналом QAJET: сначала отвяжите компанию';
    END IF;
    IF v_role IN ('owner'::public.user_role, 'manager'::public.user_role)
       AND v_target.company_id IS NULL THEN
      RAISE EXCEPTION 'Персонал QAJET не может стать сотрудником компании: у записи нет компании';
    END IF;
    -- Понижение последнего активного админа делает систему неуправляемой так же,
    -- как его блокировка.
    IF v_target.role = 'admin'::public.user_role AND v_role <> 'admin'::public.user_role THEN
      IF (
        SELECT count(*) FROM public.users
        WHERE role = 'admin'::public.user_role AND is_active AND id <> p_user_id
      ) = 0 THEN
        RAISE EXCEPTION 'Это последний активный админ: система останется без управления';
      END IF;
    END IF;
  END IF;

  UPDATE public.users
  SET full_name = v_name, role = v_role, updated_at = now()
  WHERE id = p_user_id;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.admin_update_user(uuid, text, public.user_role) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, text, public.user_role) TO authenticated;
