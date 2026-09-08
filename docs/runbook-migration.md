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

После восстановления — накатить RLS-политики из
`packages/db/policies/*.ts` (той же командой, которой они накатывались
на Supabase — Drizzle-миграции переносимы буквально, RLS не привязана к
облаку).

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
2. **Поднять официальный self-hosted Supabase** рядом с этим
   `docker-compose.yml`, поверх ТОГО ЖЕ Postgres (не своего
   изобретения — `github.com/supabase/supabase/tree/master/docker`,
   MIT, реально поддерживаемый проект: Kong, GoTrue, PostgREST, Storage).
   `NEXT_PUBLIC_SUPABASE_URL` переключается на свой домен. Это НЕ
   реализовано и не проверено в этой сессии — трудоёмкость (управление
   JWT-секретом, шаблоны писем GoTrue, конфигурация Kong) заслуживает
   отдельной сессии, не довеска к докер-компоузу.
3. **Писать свой auth/REST-шлюз.** Не рассматривается — agents.md §2 уже
   выбрал Supabase именно затем, чтобы не изобретать эту часть заново.

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
базе в РК, что и к основной (`packages/db/policies/*.ts`).
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
| `PD_BACKEND=postgres` против РЕАЛЬНОГО Postgres с RLS | ❌ Не проверено — нужен `DATABASE_URL` к базе с накаченными миграциями, тот же открытый пункт, что и у `packages/db/src/__tests__/supplier-isolation.test.ts` |
| `pg_dump`/`pg_restore` схемы `public` | ❌ Не проверено — команды стандартные для Postgres 17, но не прогонялись против реального Supabase-проекта в этой сессии |
| Self-hosted Supabase (Auth/REST) рядом с docker-compose.yml | ❌ Не реализовано — раздел 3, вариант 2, сознательно вне скоупа этой сессии |
| Физический перенос ПД в ДЦ на территории РК | ❌ Не реализовано — организационный вопрос (провайдер, SLA), не код |
