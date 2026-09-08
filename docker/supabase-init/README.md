# Вендоренные init-скрипты self-hosted Supabase

Файлы в этой директории скопированы дословно (не переписаны) из
официального `github.com/supabase/supabase` (MIT), ветка `master`,
путь `docker/volumes/db/`:

- `roles.sql`
- `jwt.sql`
- `realtime.sql`
- `webhooks.sql`
- `pooler.sql`
- `logs.sql`
- `_supabase.sql`

Дата выборки: 2026-09-08. GitHub API для точного коммита апстрима из
этой сессии недоступен (репозиторий `supabase/supabase` вне scope
текущих GitHub-доступов) — источник фиксируется по `master` HEAD на
дату выборки и SHA-256 файлов, а не по коммиту. Чтобы перепроверить
файл не устарел ли:

```sh
curl -sS "https://raw.githubusercontent.com/supabase/supabase/master/docker/volumes/db/<файл>" | sha256sum
```

и сравнить с суммами ниже (сверены в этой сессии дважды — при
вендоринге и повторно перед коммитом, оба раза совпадение):

```
9dce462adc04137d6afabcf28efa60a6c355270a4b32d7af58891ac4eb964c5f  _supabase.sql
1cc94a4f16f6e2932b383cd68e211a96bcae298437ca4120d8a5106396c58465  jwt.sql
f0463ce5030907acef49326d2bffd36002df0718035071be7c99bd7fc897c63d  logs.sql
df97ebe148d94cfb92a5e37ebf972dfd496be195f0915ecf14396b2cf50efecb  pooler.sql
7e9e442e7fc4dae05544c07b67bede37a00d84644304dfce4d937134cb4c8f88  realtime.sql
3ad717b225daa38aa982da26750f35641eb404e1eb5e69a763c22236ab96c1b2  roles.sql
b584aaaa0c393f27218f81e01e76e1d07d42f947083249adcd6097ad471cde62  webhooks.sql
```

## Почему вендорено всё, а не только нужное

`docker-compose.supabase.yml` (см. корень репозитория) поднимает
только `db`/`auth`/`rest`/шлюз — `realtime`/`storage`/`functions`
сознательно исключены (`docs/decisions/0008-*.md`), ни один путь кода
`apps/web` их не вызывает. Несмотря на это, `realtime.sql`/`pooler.sql`
и остальные скрипты **вендорены целиком**, не обрезаны: они создают
схемы/роли (`_realtime`, `_supavisor`), от которых могут неявно
зависеть роли/гранты в `roles.sql`/`webhooks.sql` — обрезка «на
глаз» без реального прогона против Postgres — тот же класс риска,
что уже разбирался в `docs/decisions/0007-rls-visibility-cascade-risk.md`
(политика показалась лишней — оказалась не лишней). Лишняя пустая
схема — не риск; отсутствующая нужная — риск.

## Что эти скрипты делают (коротко)

- `roles.sql` — задаёт пароли системным ролям (`authenticator`,
  `supabase_auth_admin`, `supabase_storage_admin` и др.) равными
  `POSTGRES_PASSWORD`.
- `jwt.sql` — кладёт `JWT_SECRET`/`JWT_EXP` в настройки базы
  (`app.settings.jwt_secret`) — читается некоторыми расширениями/
  функциями через `current_setting()`.
- `realtime.sql`, `pooler.sql`, `logs.sql` — создают служебные схемы
  (`_realtime`, `_supavisor`, `_analytics`) в отдельной базе
  `_supabase`.
- `_supabase.sql` — создаёт саму базу `_supabase`.
- `webhooks.sql` — расширение `pg_net` + схема `supabase_functions`
  для HTTP-вебхуков из триггеров Postgres.

Схема `auth` целиком (таблицы `auth.users` и т.п.) и SQL-хелперы
(`auth.uid()`, `auth.role()`, `auth.jwt()`), которые использует RLS
этого проекта (`packages/db/migrations/*.sql`), — **не в этих
файлах**, они запечены в самом образе `supabase/postgres` (его
собственный `docker-entrypoint-initdb.d`, идёт до этих
дополнительных скриптов). Эти файлы — тонкий довесок конкретно под
docker-compose-развёртывание, не полная схема Supabase.
