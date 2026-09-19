-- Права на SECURITY DEFINER функции схемы public — agents.md, раздел Privileged access.
-- Воспроизведено packages/db/src/__tests__/function-privileges.test.ts: роль
-- anon исполняла 31 функцию сверх четырёх публичных RFQ, а триггерные
-- функции были вызываемы через /rest/v1/rpc.
--
-- Почему `REVOKE ... FROM anon` в 0016 и 0018 не помогло: в Supabase EXECUTE
-- выдаётся anon явно через default privileges на каждую новую функцию, а
-- пересоздание функции возвращает грант. Поэтому здесь отзыв идёт по всем
-- функциям сразу, а default privileges сужены, чтобы новые функции больше
-- не получали право автоматически.
--
-- Публичный контур поставщика по подписанной ссылке остаётся: это ровно
-- четыре функции, каждая проверяет токен внутри.
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig, p.prorettype = 'trigger'::regtype AS is_trigger
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    IF f.is_trigger THEN
      -- Триггер исполняется без проверки EXECUTE у вызывающего, прямой вызов не нужен.
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f.sig);
    END IF;
  END LOOP;
END
$$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.get_rfq_quick_response(uuid, text) TO anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.quick_respond_rfq_public(uuid, text) TO anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.decline_rfq_public(uuid, text) TO anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.submit_rfq_public(uuid, text, jsonb) TO anon;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
