# Runbook: переезд с Vercel + Supabase Cloud на свои серверы

Фаза 8 плана. Честно, по частям — что переносится, чем, и что из этого
уже проверено в этой сессии, а что нет.

## Что переезжает и на что

| Слой | Сегодня | После переезда | Чем |
| --- | --- | --- | --- |
| Приложение | Vercel (serverless) | Свой сервер/кластер, Docker | `apps/web/Dockerfile` + `docker-compose.yml` (готово, проверено) |
| Данные (Postgres) | Supabase Cloud (`us-east-1`) | Свой Postgres 17 | `pg_dump`/`pg_restore` (ниже) |
| Файловое хранилище | Не используется ни одним путём кода | MinIO (S3 API) | `docker-compose.yml` сервис `minio` — подключён заранее, под будущую фичу |
| Auth + REST (PostgREST) | Supabase Cloud | Supabase Cloud ИЛИ self-hosted Supabase | См. раздел «Auth/REST» — это НЕ то же самое, что перенос Postgres |
| Личные данные (agents.md §11.1) | Та же Supabase-БД | Отдельный Postgres в РК (опционально, независимо от остального переезда) | `PD_BACKEND=postgres` (готово, проверено юнит-тестами) |

## 1. Приложение → Docker

Проверено в этой сессии: `docker build -f apps/web/Dockerfile .` собирает
образ (multi-stage, `output: 'standalone'`, ADR-0002), контейнер поднимается
и отдаёт настоящие `200` на `/` и `/login`. Контекст сборки — **корень
репозитория**, не `apps/web` (pnpm workspace, apps/web зависит от
`workspace:*` пакетов).

```
docker build -f apps/web/Dockerfile -t qajet-web .
docker compose up -d --build web
```

`docker-compose.yml` целиком поднимает `postgres` + `minio` + `web` —
все три сервиса проверены живьём (postgres принимает соединения,
`minio-init` создаёт бакет `qajet-files`, `web` отвечает по HTTP).
Переменные — в `.env` рядом с `docker-compose.yml`, шаблон —
`.env.docker.example`.

## 2. Данные → свой Postgres

Supabase Cloud — обычный Postgres 17 под капотом, поэтому перенос —
стандартный `pg_dump`/`pg_restore`, не что-то специфичное для Supabase:

```bash
# Строка подключения — в настройках проекта Supabase (Database → Connection string,
# "Direct connection", не pooler-порт 6543 — pg_dump с ним не дружит).
pg_dump "postgresql://postgres:<пароль>@db.<project>.supabase.co:5432/postgres" \
  --schema=public --no-owner --no-privileges -Fc -f qajet.dump

# На новом сервере — тот же Postgres 17 (docker-compose.yml поднимает его сам).
pg_restore --no-owner --no-privileges -d "$DATABASE_URL" qajet.dump
```

**Схемы `auth`, `storage`, `realtime` НЕ переносятся** этой командой
(`--schema=public` намеренно) — это внутренние схемы Supabase, они не
часть прикладных данных QAJET. Что с ними делать — см. следующий раздел.

После восстановления — накатить миграции `packages/db/migrations/*.sql`
(RLS-политики инлайн в них, отдельного файла политик нет) той же
командой, которой они накатывались на Supabase —
`pnpm --filter @qajet/db db:migrate` (`packages/db/src/scripts/migrate.ts`,
`DATABASE_URL`) — Drizzle-миграции переносимы буквально, RLS не
привязана к облаку.

## 3. Auth/REST — то, что перенос Postgres НЕ решает

`apps/web` не ходит в Postgres напрямую (кроме нового `PD_BACKEND=postgres`
для персональных данных, п.4) — весь остальной код говорит с
`NEXT_PUBLIC_SUPABASE_URL` по HTTP через `@supabase/ssr`/`@supabase/supabase-js`:
`/auth/v1/*` (вход, сессии) и `/rest/v1/*` (PostgREST — сгенерированный
REST поверх схемы и RLS). Перенос **только** Postgres, без этого слоя,
оставляет приложение без входа и без чтения данных.

Три реальных варианта, без псевдовыбора:

1. **Оставить Auth/REST на Supabase Cloud, перенести только данные.**
   `NEXT_PUBLIC_SUPABASE_URL` не меняется — Supabase Cloud продолжает быть
   единственным источником для Auth/REST, а `postgres` в
   `docker-compose.yml` используется только под `PD_BACKEND=postgres`
   (персональные данные, п.4) или простаивает. Меньше всего работы,
   больше всего зависимости от Supabase Cloud остаётся.
2. **Self-hosted Supabase рядом с этим `docker-compose.yml`.**
   `docker-compose.supabase.yml` — минимальный набор под фактическое
   использование кода (`db`/`auth`/`rest` + свой маленький шлюз, не
   `realtime`/`storage`/`imgproxy`/`meta`/`functions`/`supavisor`/`studio`
   — обоснование в `docs/decisions/0008-self-hosted-supabase-minimal-services.md`).
   `NEXT_PUBLIC_SUPABASE_URL` переключается на адрес шлюза (по умолчанию
   `http://<хост>:8000`). Запуск:

   ```bash
   # 1. Секреты и ключи в .env (см. .env.docker.example) — POSTGRES_USER/DB
   #    ОБЯЗАНЫ быть postgres/postgres при этом варианте, JWT_SECRET
   #    минимум 32 символа:
   JWT_SECRET=$(openssl rand -base64 32) node docker/supabase-init/generate-keys.mjs
   # вывод (ANON_KEY/SERVICE_ROLE_KEY) — скопировать в .env вместе с JWT_SECRET

   # 2. Поднять стек:
   docker compose -f docker-compose.yml -f docker-compose.supabase.yml up -d

   # 3. Дождаться, пока `auth` станет healthy (GoTrue проводит СВОЮ
   #    миграцию схемы auth под свою версию при первом старте — команда
   #    ниже просто показывает статус, дожидаться нужно вручную/скриптом
   #    healthcheck-опроса) и только затем катить схему приложения:
   docker compose -f docker-compose.yml -f docker-compose.supabase.yml ps auth
   pnpm --filter @qajet/db db:migrate
   ```

   Это НЕ проверено живым запуском в сессии, где написано — Docker-демон
   недоступен в песочнице разработки (см. таблицу ниже и ADR-0008).
   Конфиг подготовлен к первому реальному прогону, не выдаётся за готовый.
3. **Писать свой auth/REST-шлюз (полностью, включая сам GoTrue/PostgREST).**
   Не рассматривается — agents.md §2 уже выбрал Supabase именно затем,
   чтобы не изобретать эту часть заново. (Маленький HTTP-шлюз ПЕРЕД
   готовыми GoTrue/PostgREST в варианте 2 выше — не то же самое: сама
   логика авторизации/данных остаётся на Supabase, переизобретён только
   маршрутизирующий слой, и обоснованно — см. ADR-0008.)

## 4. Персональные данные → казахстанский ДЦ (agents.md §11.1, ADR-0005)

Независимо от остального переезда: `packages/pd` — единственная точка
доступа к ПД (`users.full_name/email`, `requests.delivery_address`).
Переключение на отдельный Postgres в РК:

```bash
PD_BACKEND=postgres
PD_DATABASE_URL=postgresql://<пользователь>:<пароль>@<хост-в-РК>:5432/<база>
```

Без `PD_DATABASE_URL` используется `DATABASE_URL`, если задан. Ни одна
строка в `apps/web` не меняется — `createPdClient()` из `@qajet/pd`
сам решает, какая реализация `PdBackend` активна.

**Обязательное условие**, не опция: та же RLS-политика, применённая к
базе в РК, что и к основной (миграции `packages/db/migrations/*.sql`).
`createPostgresPdBackend()` подключается под ролью `authenticated` и
подставляет `sub` текущего пользователя в `request.jwt.claims` на
каждый вызов — без RLS на целевой базе это было бы равносильно доступу
от суперпользователя ко всем строкам `users`/`requests`.

**Что не реализовано**: сама физическая репликация/перенос данных
`users`/`requests` в дата-центр на территории РК — это вопрос выбора
конкретного провайдера и соглашения об SLA, не кода. Механизм
переключения (код + тесты) готов, данные пока там же, где и всё
остальное (Supabase Cloud, `us-east-1`) — тот же честный статус, что
и в README «Известные ограничения» до этой сессии, сузившийся с «нет
механизма» до «механизм есть, данные не перенесены».

## Проверено vs не проверено в этой сессии

| Шаг | Статус |
| --- | --- |
| `docker build` собирает образ apps/web | ✅ Проверено — реальный контейнер, реальные `200` на `/`, `/login` |
| `docker-compose.yml` поднимает postgres+minio+web | ✅ Проверено — healthcheck'и зелёные, бакет создан, Postgres принимает `select 1` |
| `PD_BACKEND=postgres` переключает бэкенд ПД | ✅ Юнит-тестами (фейковый `Sql`) — контракт (какая claim, какой SQL) проверен |
| `PD_BACKEND=postgres` против РЕАЛЬНОГО Postgres с RLS | ✅ Проверено в GitHub Actions run `34686363385`: интеграционный тест (`packages/pd/src/__tests__/postgres-backend-rls.test.ts`) подтвердил, что два покупателя в разных компаниях не видят чужой `delivery_address`. Локально Docker по-прежнему недоступен в песочнице разработки, поэтому локальный полный прогон не выполнялся |
| `pg_dump`/`pg_restore` схемы `public` | ❌ Не проверено — команды стандартные для Postgres 17, но не прогонялись против реального Supabase-проекта в этой сессии |
| Self-hosted Supabase (Auth/REST) рядом с docker-compose.yml | 🔧 Конфиг написан, не запущен — Docker недоступен в песочнице разработки (раздел 3, вариант 2; `docker-compose.supabase.yml`, ADR-0008) |
| Физический перенос ПД в ДЦ на территории РК | ❌ Не реализовано — организационный вопрос (провайдер, SLA), не код |
