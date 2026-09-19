# Базовая линия и итоги: доказательства и их границы

Локальные тесты никогда не доказывают поведение провайдера, деплоя, CI или
продакшена. Ниже — что проверено, чем и что остаётся вне ветки.

## Словарь

- `CONFIRMED` — проверено по названному артефакту или выводу команды.
- `REPRODUCED` — исполняемый сценарий запущен и показал поведение.
- `NOT REPRODUCED` — релевантный сценарий запущен и поведение не подтвердил.
- `NOT RUN` — проверка сознательно не выполнялась; это не доказательство.
- `ASSUMPTION` — вход для планирования, никогда не доказательство.

## Исходная точка `22a5a88` (до работ)

Windows 11, Node v24.19 (в CI — Node 22, отдельный гейт).

| Проверка | Результат |
| --- | --- |
| `pnpm lint`, `pnpm typecheck` | PASS |
| `pnpm test` | 239 PASS, **24 SKIPPED** — тесты с базой без `DATABASE_URL` пропускались с кодом 0 |
| Живой E2E | не запускался: job без секретов пропускал шаги и был зелёным |

## Итог ветки `refactor/ux-reliability` (локально)

Стек: Supabase CLI 2.117.0 (Postgres 17, Auth, REST, Storage), production-сборка
Next.js, Playwright/Chromium. База пересоздана с нуля (`supabase db reset`,
миграции 0000–0049, `db:reset` с демо-данными).

| Проверка | Состояние | Результат |
| --- | --- | --- |
| Lint (Biome) | `REPRODUCED` PASS | 366 файлов |
| Typecheck | `REPRODUCED` PASS | 6 пакетов |
| Юнит-тесты | `REPRODUCED` PASS | engine 137, web 92, ui 13, pd 13, db 76 (при заданном `DATABASE_URL`; ничего не пропущено) |
| `test:rls` с реальным PostgreSQL | `REPRODUCED` PASS | db 61 тест в 17 файлах, pd 1 |
| Production-сборка `apps/web` | `REPRODUCED` PASS | |
| Playwright, весь набор | `REPRODUCED` PASS | **18 из 18**: путь покупателя (7), заявка → закрытие с возвратом и с доплатой (2), бюджет кадров, публичные (9) |

## Живые факты продакшена (19.09.2026)

Только чтение через коннекторы Vercel и Supabase и публичные GET; в боевые
системы ничего не записывалось.

| Факт | Состояние | Источник |
| --- | --- | --- |
| `/api/health` = 200, commit `6eb07fb`; `/api/ready` = 503 | `CONFIRMED` | GET `qajet-seven.vercel.app` |
| В Vercel production 4 переменные; нет `SUPABASE_SERVICE_ROLE_KEY` и `CRON_SECRET` | `CONFIRMED` | Vercel env API (значения не читались) |
| Причина 503 — отсутствующий service-role ключ; без `CRON_SECRET` `/api/jobs/*` отвечает 401 и очередь RFQ не разбирается | `CONFIRMED` | env API + код маршрутов |
| `22a5a88` не деплоился; `origin/main` = `6eb07fb` | `CONFIRMED` | git + деплои Vercel |
| Боевой Supabase в `ap-southeast-1` (Сингапур) | `CONFIRMED` | Supabase API |
| Советник Supabase: 37 функций `SECURITY DEFINER` исполнимы `anon`; защита от утёкших паролей выключена | `CONFIRMED` | advisor (до миграций 0042–0043) |
| Строгий гейт `check-release-readiness --strict --ready-url=…` на production | `REPRODUCED` FAIL, как и должен | `/api/ready` = 503 |

## Вне ветки

| Проверка | Состояние | Почему |
| --- | --- | --- |
| CI на целевом SHA | `NOT RUN` | появится после пуша |
| Миграции 0040–0049 на боевой базе | `NOT RUN` | не применялись; требуют ревью |
| Деплой, секреты, провайдеры | `NOT RUN` | вне объёма, боевая инфраструктура не менялась |
| Резидентность данных в КЗ, бэкап/восстановление, реальный пилот | `NOT RUN` | внешние решения |
| axe-проверка, `prefers-reduced-motion`, путь админа | `NOT RUN` | вне объёма |
