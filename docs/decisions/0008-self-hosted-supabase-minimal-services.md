# ADR-0008 — Self-hosted Supabase: минимальный набор сервисов, не весь официальный стек

Дата: 2026-09-08
Статус: принято, конфиг написан — не проверено живым запуском

## Контекст

`docs/runbook-migration.md` §3 описывает три варианта Auth/REST при
переезде с Supabase Cloud; вариант 2 (self-hosted Supabase рядом с
`docker-compose.yml`) был сознательно отложен в прошлой сессии как
«отдельная сессия, не довесок» — из-за трудоёмкости (JWT-секрет,
почтовые шаблоны GoTrue, конфигурация шлюза).

Официальный `github.com/supabase/supabase/tree/master/docker` (сверено
на дату этой записи) поднимает 11 сервисов: `studio`, `api-gw`
(Envoy — терминология «Kong» из более старой версии апстрима устарела,
сам проект уже перешёл на Envoy), `auth` (GoTrue), `rest` (PostgREST),
`realtime`, `storage`, `imgproxy`, `meta`, `functions`, `db`
(`supabase/postgres`, не ванильный `postgres`), `supavisor`.

Приложение (`apps/web`) обращается к Supabase только через один файл —
`apps/web/lib/supabase/server.ts` (`createServerClient` из
`@supabase/ssr`, серверный клиент, не браузерный — в проекте вообще нет
клиентского Supabase-файла). Читает `NEXT_PUBLIC_SUPABASE_URL`/
`NEXT_PUBLIC_SUPABASE_ANON_KEY`. Ни Realtime-подписок, ни вызовов
Supabase Storage, ни Edge Functions нигде в коде нет (подтверждено
grep по всему репозиторию).

## Решение

Поднимать минимальный набор: `db` (образ подменён на
`supabase/postgres`), `auth`, `rest`, и собственный маленький шлюз
(не вендоренный Envoy — см. ниже). Осознанно исключены:

- **`realtime`, `storage`, `imgproxy`, `meta`, `functions`,
  `supavisor`** — ни одного вызывающего места в коде ни для одного из
  них. Каждый включённый сервис — лишняя площадь атаки и эксплуатации
  без функциональной пользы сегодня. `supavisor` (пулер соединений)
  особенно избыточен: приложение уже подключается к `postgres`
  напрямую через пакет `postgres` (`DATABASE_URL`/`PD_BACKEND=postgres`)
  без пулинга, ставить пулер перед единственным инстансом приложения —
  чистый оверхед без выигрыша.
- **`studio`** — функционально тоже не нужен коду, но это не тот же
  случай, что у остальных: у того, кто реально держит self-hosted стек
  в проде, не будет способа руками посмотреть пользователей/сессии/SQL
  при инциденте без него. Это не «никому не нужно», а задокументированный,
  простой follow-up при необходимости — отдельный оверлей
  (`docker-compose.supabase.studio.yml`, за `DASHBOARD_USERNAME`/
  `PASSWORD`, без публичного порта), не часть дефолтного минимального
  набора этого ADR.

## Шлюз — свой, не вендоренный официальный

Официальный `docker/volumes/api/envoy/lds.template.yaml` — 1101 строка
маршрутов, жёстко прописанных под полный 8-сервисный стек (studio,
realtime, storage, functions, meta и т.д.). Безопасно обрезать его
вручную под 2 маршрута (`/auth/v1`, `/rest/v1`) без реального прогона
Envoy — необоснованный риск: эмпирически проверить негде (см.
«Проверено vs не проверено» ниже), а неверно обрезанный YAML/Lua-фильтр
ломается тихо, не на этапе написания.

Вместо этого — `docker/supabase-gateway/nginx.conf.template`, маленький
конфиг ровно под два маршрута, которые реально нужны
(`/auth/v1/` → GoTrue, `/rest/v1/` → PostgREST, `prefix_rewrite: /` —
прямой аналог `proxy_pass` с завершающим `/`). apikey-проверка
(заголовок `apikey` сверяется с `ANON_KEY`/`SERVICE_ROLE_KEY`)
сохранена — это реальная логика оригинального Envoy-фильтра, не
опущена как мелочь. Не реализована опциональная asymmetric `sb_`-key
трансляция (`SUPABASE_PUBLISHABLE_KEY`/`SUPABASE_SECRET_KEY`) — сам
апстрим по умолчанию её тоже не включает (нужны все 4 доп. переменные,
иначе `docker-entrypoint.sh` апстрима сам печатает «legacy API key
mode»), так что это не урезание реально работающей функциональности.

CORS в шлюзе намеренно не настроен: `apps/web` ходит к Supabase только
с сервера (`createServerClient`, не браузер) — CORS не нужен для
server-to-server вызовов.

## Совместимость Postgres — операционное требование, не деталь

`supabase/postgres` и вендоренные `docker/supabase-init/*.sql`
рассчитаны на суперпользователя `postgres` и базу данных `postgres`
(та же конвенция, что у официального self-hosted Supabase — их
`.env.example` вообще не задаёт `POSTGRES_USER`, подразумевая
дефолтное имя). Базовый `docker-compose.yml` по умолчанию использует
`POSTGRES_USER=qajet`/`POSTGRES_DB=qajet` — при подъёме
`docker-compose.supabase.yml` эти значения в `.env` **обязаны** быть
`postgres`/`postgres` (задокументировано в `.env.docker.example`),
иначе `auth`/`rest`, ожидающие ролей `supabase_auth_admin`/
`authenticator` в базе `postgres`, не найдут своих объектов. Базовый
`docker-compose.yml` сам по себе (без оверлея) продолжает работать с
именами `qajet`/`qajet` как раньше — это не меняет то, что уже
задокументировано проверенным в `docs/runbook-migration.md`.

## Проверено vs не проверено

Живьём проверено в этой сессии, без демона:
- `docker compose -f docker-compose.yml -f docker-compose.supabase.yml
  config` — мердж валиден, `exit 0`, все переменные резолвятся
  (тестовый `.env`, не боевые значения). `postgres_data` — том из
  базового файла — сохранён, новые bind-mount'ы init-скриптов
  добавлены поверх (Compose мерджит списки конкатенацией, не заменой —
  эмпирически подтверждено тем же способом).
- `docker/supabase-init/generate-keys.mjs` — запущен, вывод
  декодирован вручную (`node -e`, base64url) и независимо
  перепроверен HMAC-подписью через `node:crypto` в одноразовой
  команде: `role: "anon"`/`role: "service_role"` корректны, подпись
  совпадает.
- Вендоренные `docker/supabase-init/*.sql` — скопированы дословно с
  `master` HEAD апстрима на дату выборки, зафиксированы SHA-256
  (`docker/supabase-init/README.md`).

**Не проверено, физически невозможно в этой сессии** (Docker-демон не
поднимается — `systemctl status docker` → «System has not been booted
with systemd as init system», тот же класс ограничения, что у волн
A.2/D.2): реальный `docker compose ... up`, `/auth/v1/health`,
сквозной вход через шлюз, `/rest/v1/<table>` с реальной
RLS-фильтрацией, и заявленный порядок запуска (auth healthy раньше
`pnpm --filter @qajet/db db:migrate`). Первый живой прогон — открытая
проверка для сессии с работающим Docker.
