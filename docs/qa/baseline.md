# Базовая линия: доказательства и их границы

Документ фиксирует, что проверено и чем. Локальные тесты никогда не доказывают
поведение провайдера, деплоя, CI или продакшена.

## Словарь

- `CONFIRMED` — проверено по названному артефакту или выводу команды.
- `REPRODUCED` — исполняемый сценарий запущен в этой работе и показал поведение.
- `NOT REPRODUCED` — релевантный сценарий запущен и поведение не подтвердил.
- `NOT RUN` — проверка сознательно не выполнялась; это не доказательство.
- `ASSUMPTION` — вход для планирования, никогда не доказательство.

## Исходная точка: `22a5a88`

Прогон на Windows 11, Node v24.19 (CI использует Node 22 — это отдельный гейт).

| Проверка | Состояние | Результат |
| --- | --- | --- |
| `pnpm lint` | `CONFIRMED` | PASS, 341 файл |
| `pnpm typecheck` | `CONFIRMED` | PASS, 6 пакетов |
| `pnpm test` | `CONFIRMED` | 239 PASS, **24 SKIPPED** |
| Тесты с реальным Postgres | `CONFIRMED` | все 24 пропущены: `DATABASE_URL` не задан, а `--passWithNoTests` + `describe.skip` дают код 0 без сигнала |

Вывод: зелёный `pnpm test` без базы ничего не говорит об изоляции арендаторов.

## Живые факты продакшена (19.09.2026)

Получены только чтением через коннекторы Vercel и Supabase и публичными GET.
В боевые системы ничего не записывалось.

| Факт | Состояние | Источник |
| --- | --- | --- |
| `/api/health` = 200, commit `6eb07fb` | `CONFIRMED` | GET `qajet-seven.vercel.app/api/health` |
| `/api/ready` = 503 | `CONFIRMED` | GET `qajet-seven.vercel.app/api/ready` |
| В Vercel production ровно 4 переменные: `NEXT_PUBLIC_SITE_URL`, `LINK_SIGNING_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `CONFIRMED` | Vercel env API (значения не расшифровывались) |
| Причина 503: нет `SUPABASE_SERVICE_ROLE_KEY`, а `/api/ready` ходит через service-role клиент | `CONFIRMED` | env API + `apps/web/app/api/ready/route.ts` |
| Нет `CRON_SECRET` → `/api/jobs/*` в production отвечает 401 → очередь уведомлений RFQ не разбирается | `CONFIRMED` | env API + `apps/web/app/api/jobs/outbox/route.ts` |
| `22a5a88` не запушен и не деплоился; `origin/main` = `6eb07fb` | `CONFIRMED` | git + список деплоев Vercel |
| Боевой Supabase `qajet` в `ap-southeast-1` (Сингапур) | `CONFIRMED` | Supabase API; противоречит §11.1 спецификации |
| 37 `SECURITY DEFINER` функций исполнимы ролью `anon`, 53 — ролью `authenticated` | `CONFIRMED` | Supabase security advisor |
| Защита от утёкших паролей (HaveIBeenPwned) выключена | `CONFIRMED` | Supabase security advisor |

## Что остаётся вне этой ветки

| Проверка | Состояние | Почему |
| --- | --- | --- |
| Настройка секретов и деплой в production | `NOT RUN` | Требует решения владельца; ветка не деплоится |
| Резидентность данных в КЗ | `NOT RUN` | Инфраструктурное решение вне репозитория |
| CI на целевом SHA | `NOT RUN` | Появится после пуша ветки |
