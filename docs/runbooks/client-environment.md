# Окружение для платных клиентов — действия владельца

## Почему нельзя заводить клиента в текущий production

Проект `eoqcktgvnzayyinulbch` (qajet-seven.vercel.app) — **демо**. Проверено
2026-09-29 SQL-запросом без входа (`crypt()` по `auth.users`):

- все пять демо-аккаунтов, включая `admin@demo.qajet.kz` и
  `concierge@demo.qajet.kz`, принимают пароль `qajet2026`, который лежит в
  репозитории (`packages/db/src/seed/accounts.ts`). Админ и консьерж видят
  данные **всех** компаний;
- в пуле подбора 16 выдуманных поставщиков — реальный RFQ клиента ушёл бы им;
- `settings.qajet_requisites` — демо-реквизиты (БИН `241140012345`, выдуманный
  IBAN). Они попадают в каждый счёт и акт.

Сейчас там только демо-данные, поэтому это не инцидент. Инцидентом это станет в
день, когда туда заведут первого клиента. Демо остаётся демо; клиенты живут в
отдельном проекте.

## Что сделать (≈1 час, без кода)

1. **Решить, где живёт клиентская база.** Закон РК о персональных данных требует
   хранения данных резидентов в РК — варианты и цены в
   [ADR-0011](../decisions/0011-personal-data-residency-options.md). Если пилот
   идёт до этого решения — это осознанный риск владельца, а не молчаливое
   допущение.
2. **Создать отдельный проект Supabase** (или self-hosted по
   `docs/runbook-migration.md`). Никогда не переиспользовать демо-проект.
3. **Применить миграции** к новой базе:
   `DATABASE_URL=<новая> pnpm --filter @qajet/db db:migrate`.
4. **Подготовить реквизиты** настоящего юрлица в JSON (ключи: `legalName`,
   `bin`, `address`, `bankName`, `iban`, `bik`, `phone`, `email`). Скрипт
   проверит БИН, контрольную сумму IBAN, БИК и откажет на демо-значениях.
5. **Разметить окружение и завести первого админа:**

   ```bash
   DATABASE_URL=… NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
   CLIENT_ADMIN_EMAIL=you@company.kz CLIENT_ADMIN_NAME='Имя Фамилия' \
   CLIENT_ADMIN_PASSWORD='<свой, от 12 символов>' \
   pnpm --filter @qajet/db db:provision-clients --requisites=./requisites.json
   ```

   Скрипт откажется работать на базе с демо-аккаунтами, демо-заказом или
   любыми заявками. После него `db:seed` и `db:reset` для этой базы
   заблокированы даже с `--force` (снять метку можно только SQL-ом:
   `delete from settings where key = 'environment_kind'`).
6. **Отдельный Vercel-проект (или окружение) для клиентов** с переменными
   нового Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `LINK_SIGNING_SECRET`,
   `CRON_SECRET` (новые значения, не из демо), затем `RESEND_API_KEY` и
   `RESEND_FROM_EMAIL` — см. `production-environment.md`.
7. **Планировщик** — секреты в Supabase Vault нового проекта, как в
   `production-environment.md` → «Планировщик фоновых задач».
8. **Поставщиков заводит админ** через «Компании» и верифицирует — только
   реальных.
9. **Бэкап до первого клиента:** `tools/ops/backup-database.mjs` с
   `DATABASE_URL` нового проекта (см. `backup-restore.md`), либо тариф Supabase
   с ежедневными бэкапами.

## Чего не делать

- Не «чистить» демо-проект под клиентов: пароль демо-админа в истории git
  останется навсегда.
- Не запускать `db:reset`/`db:seed` с `DATABASE_URL` клиентской базы (скрипты
  откажут, но не стоит проверять).
- Не копировать секреты демо в клиентское окружение.

## Статус

`db:provision-clients`: отказ на демо-базе, запрет сброса и сида после метки —
PASS локально (`client-environment.test.ts`, `environment.test.ts`, ручной прогон
против локального стека). Успешный прогон на настоящем чистом проекте — NOT RUN.
