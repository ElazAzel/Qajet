-- Планировщик фоновых задач переезжает из GitHub Actions в базу (pg_cron).
--
-- Почему. Раньше .github/workflows/jobs.yml запускался каждые 15 минут — 96 раз
-- в сутки. Каждый запуск длился около 7 секунд, но GitHub округляет каждую
-- задачу вверх до целой минуты. Выходило около 2 880 оплачиваемых минут в месяц
-- при бесплатных 2 000 на приватный репозиторий: планировщик сам по себе
-- гарантированно исчерпывал лимит, после чего GitHub блокировал и его, и CI
-- («recent account payments have failed or your spending limit needs to be
-- increased»). В результате очередь уведомлений не разбиралась вовсе, и RFQ не
-- доходили до поставщиков.
--
-- pg_cron работает внутри базы и поминутно не тарифицируется. pg_net отправляет
-- HTTP-запрос из базы асинхронно: функция ставит запрос в очередь и сразу
-- возвращается, запрос уходит после фиксации транзакции.
--
-- Секреты НЕ хранятся в миграции. Функция читает их из Supabase Vault по имени:
--   qajet_cron_secret — то же значение, что CRON_SECRET в Vercel;
--   qajet_app_url     — адрес приложения, например https://qajet-seven.vercel.app
-- Их кладёт владелец (docs/runbooks/production-environment.md). Пока их нет,
-- функция не делает ничего, а не шлёт запросы, заведомо обречённые на 401.
--
-- Права. Вызывает функцию только pg_cron, от имени владельца задания. Роли
-- authenticated и anon права на неё не получают: иначе любой вошедший мог бы
-- дёргать фоновые задачи сколько угодно раз. 0043 выдаёт EXECUTE роли
-- authenticated каждой НОВОЙ функции по умолчанию, поэтому отзыв здесь явный.
-- Тесты: packages/db/src/__tests__/scheduled-jobs.test.ts.

CREATE EXTENSION IF NOT EXISTS pg_cron;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_net;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.run_scheduled_jobs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret text;
  v_app_url text;
  v_job text;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets WHERE name = 'qajet_cron_secret';
  SELECT decrypted_secret INTO v_app_url
  FROM vault.decrypted_secrets WHERE name = 'qajet_app_url';

  -- Нет конфигурации — нечего делать. Это ожидаемое состояние до того, как
  -- владелец положит секреты, а не ошибка.
  IF nullif(trim(v_secret), '') IS NULL OR nullif(trim(v_app_url), '') IS NULL THEN
    RETURN;
  END IF;

  -- Хвостовой слэш в адресе дал бы «//api/jobs/…».
  v_app_url := rtrim(trim(v_app_url), '/');

  FOREACH v_job IN ARRAY ARRAY['outbox', 'learning'] LOOP
    PERFORM net.http_post(
      url := v_app_url || '/api/jobs/' || v_job,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_secret,
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  END LOOP;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.run_scheduled_jobs() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- cron.schedule с именем заменяет задание с тем же именем, поэтому повторное
-- применение миграции не плодит дубли.
SELECT cron.schedule('qajet-drain-queues', '*/15 * * * *', 'select public.run_scheduled_jobs()');
