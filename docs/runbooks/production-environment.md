# Production environment — owner setup

One-time configuration that only a human with account access can perform.
Ongoing operations live in [operations.md](./operations.md).

**Status on 2026-09-20:** production is deployed and healthy but **not ready**.
Three variables are missing. Nothing below can be done by an agent: an agent must
never generate, set, rotate or print a secret value.

Secret **names** are not secret. Secret **values** must never appear in a commit,
a log, a chat message, a screenshot or a ticket.

---

## Where things live

| Thing | Identifier |
| --- | --- |
| Vercel project | `qajet` (team `elazazels-projects`) |
| Supabase project | `qajet`, ref `eoqcktgvnzayyinulbch`, region `ap-southeast-1` |
| Production URL | `https://qajet-seven.vercel.app` |
| GitHub repository | `ElazAzel/Qajet` |

Currently set in Vercel production: `NEXT_PUBLIC_SITE_URL`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`LINK_SIGNING_SECRET`. Nothing is hidden from the listing.

Currently set in GitHub Actions: **nothing**. Zero secrets, zero variables.

---

## 1. `SUPABASE_SERVICE_ROLE_KEY` — unblocks `/api/ready`

This is the single reason `/api/ready` returns 503.
`apps/web/app/api/ready/route.ts` requires exactly three variables; the other two
are already present and the database is `ACTIVE_HEALTHY`, so this one alone
should return readiness to 200.

**Get the value:** Supabase dashboard → project `qajet` → *Project Settings* →
*API keys* → the **`service_role`** key. Not the `anon` key.

**Set it:** Vercel → project `qajet` → *Settings* → *Environment Variables* →
Add.

- Name: `SUPABASE_SERVICE_ROLE_KEY`
- Environment: **Production** only
- Sensitive: yes

This key bypasses Row Level Security completely. It belongs only in server
environment variables — never in `NEXT_PUBLIC_*`, never in client code, never in
a preview environment shared more widely than production.

**Redeploy** after adding it. Environment variables are read at build and runtime;
an existing deployment will not pick it up on its own.

---

## 2. `CRON_SECRET` — unblocks the job queue

**Changed with migration `0057`:** the scheduler no longer runs in GitHub
Actions. It runs inside Supabase via `pg_cron` — see the section «Планировщик
фоновых задач — теперь в базе» at the end of this file. The GitHub schedule
burned roughly 2 880 billed minutes a month (96 runs a day, each rounded up to a
full minute) against 2 000 free ones, which is what blocked CI.

The job endpoints themselves are correct — `/api/jobs/outbox` and
`/api/jobs/learning` both return 401 unauthenticated. The scheduler simply needs
the credential.

**Generate a value** (do this yourself, in your own terminal):

```bash
openssl rand -hex 32
```

**Set the same value in both places.** If they differ, the bearer token will not
match and the jobs will return 401 instead of running.

- Vercel → project `qajet` → *Settings* → *Environment Variables*
  → name `CRON_SECRET`, environment **Production**, sensitive.
- Supabase → project `qajet` → *Project Settings* → *Vault* → secret named
  **`qajet_cron_secret`**. Also add `qajet_app_url`. Details at the end of this file.

GitHub → *Secrets* → `CRON_SECRET` is now optional: it is used only when you run
the «Scheduled jobs» workflow by hand.

On rotation, change Vercel and Vault together.

---

## 3. `RESEND_API_KEY` — unblocks real mail

**Read section 4 before setting this.** The key is necessary but not sufficient:
there is a code defect that must be fixed alongside it.

**Get the value:** Resend dashboard → *API Keys*. The sending domain must be
verified, or Resend will reject the send.

**Set it:** Vercel → project `qajet` → Production, sensitive.

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL` — optional. Without it the code falls back to
  `QAJET <onboarding@resend.dev>`, which is fine for a smoke test and wrong for a
  pilot.

---

## 4. The mail path has a defect, not just a missing key

`createEmailAdapter()` in `apps/web/app/lib/notifications/email-adapter.ts`:

```ts
return apiKey ? new ResendAdapter(apiKey) : new LocalSinkAdapter();
```

`LocalSinkAdapter.send()` returns `{ providerMessageId: 'local:…',
transport: 'local-sink' }` — a **success**. So with the key absent, the outbox
drains normally and marks every notification sent while nothing is delivered.
`transport` is returned but never persisted or displayed, so `/admin/outbox`
shows a clean queue and no operator can tell.

`operations.md` describes this as expected dev degradation, which it is —
locally. In production it is a silent data lie: a supplier who never received an
RFQ appears, to everyone looking at the system, to have been notified.

Setting `RESEND_API_KEY` hides the defect without fixing it. Production must
refuse to sink silently — either fail closed when the key is absent in a
production environment, or persist `transport` and surface `local-sink` as a
distinct not-delivered state. Fixed on branch `refactor/pilot-readiness`: the adapter now throws in
production when the key is absent, and the dispatcher builds it before claiming
rows, so a missing key leaves the queue `pending` (no attempts burned) and the
scheduled job returns 503 instead of reporting success. This takes effect only
once that commit is deployed.

---

## Verification — in this order

After 1 and 2 are set and the project has redeployed:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://qajet-seven.vercel.app/api/ready
```

Expect `200`. If it is still 503, read the body — it names the missing variable:

```bash
curl -s https://qajet-seven.vercel.app/api/ready
```

Then dispatch the scheduler manually rather than waiting for the next tick:

```bash
gh workflow run "Scheduled jobs"
gh run list --workflow="Scheduled jobs" --limit 1
```

Expect success, with both `outbox: HTTP 200` and `learning: HTTP 200` in the log.
Then let one natural 15-minute tick pass and confirm it also succeeds.

Mail is **not** verified by any of the above. Verifying it means sending one
synthetic RFQ to a controlled test recipient and confirming the message actually
arrives — enqueue, drained by the scheduler, provider accepted, delivery state
recorded, retry safe, no duplicate. An outbox row reaching `sent` is not evidence
of delivery.

---

## Still external after this

- **Leaked-password protection** is disabled in Supabase Auth
  (advisor `auth_leaked_password_protection`). Dashboard →
  *Authentication* → *Policies*. This is a configuration change, not a migration.
- **Data residency.** Production Supabase is in `ap-southeast-1` (Singapore); the
  specification requires Kazakhstan before real personal data. This needs a
  written decision, not a refactor.
- **Backup and restore.** A backup that has never been restored is not verified.

## Защита от утёкших паролей без платного тарифа

Встроенная защита Supabase (`auth_leaked_password_protection`) доступна только
на платных тарифах и **по-прежнему выключена**. Вместо неё в приложении
работает проверка по базе Have I Been Pwned:
`apps/web/app/lib/auth/pwned-password.ts`.

Наружу уходят только первые пять знаков SHA-1 пароля (k-анонимность), сам
пароль и его полный хеш сервер не отправляет. Ключа и регистрации сервис не
требует, платить не нужно.

Проверка отказывает в сторону пользователя: недоступность сервиса, ответ не 200
или таймаут означают «про утечку неизвестно», и пароль принимается. Сбой чужой
службы не должен оставлять человека без пароля.

Ограничения, которые стоит знать владельцу:

- проверяются только **новые** пароли при установке (`/auth/set-password`,
  восстановление). Уже существующие пароли не перепроверяются;
- это не замена платной функции целиком: платформенная защита работает и на
  путях, которых приложение не контролирует;
- при включении платного тарифа включите встроенную защиту и оставьте эту —
  они не конфликтуют.

## Презентация (питч-дек) больше не в репозитории

Файл `QAJET-pitch.pdf` весил 25,5 МБ и составлял 98,6% всего `apps/web/public`.
Next копирует `public/` в `standalone` при каждой сборке, и на Windows это
привело к отказу сборки: антивирус держал свежую копию, `next build` падал с
`EBUSY ... unlink`. Файл удалён из рабочего дерева; в истории git он остался и
достаётся командой:

```bash
git show d0a529a^:apps/web/public/startupbattle/QAJET-pitch.pdf > QAJET-pitch.pdf
```

Чтобы кнопки скачивания вернулись, задайте **`NEXT_PUBLIC_PITCH_PDF_URL`** —
публичный адрес файла. Это не секрет, префикс `NEXT_PUBLIC_` означает, что
значение попадает в браузер.

Куда положить файл (любой вариант):

- **Supabase Storage**, публичный бакет — бесплатный тариф даёт 1 ГБ. Загрузка
  делается через интерфейс Supabase, адрес вида
  `https://<project>.supabase.co/storage/v1/object/public/<bucket>/QAJET-pitch.pdf`.
- Любой файловый хостинг или CDN с прямой ссылкой на PDF.

Пока переменная не задана, страница `/startupbattle` **не показывает битых
ссылок**: кнопки скачивания и ссылки «Питч-дек» просто нет, вместо неё строка
«Презентацию пришлём по запросу». Сценарий `e2e/startupbattle.spec.ts`
проверяет именно это: либо ссылка ведёт на заданный адрес, либо её нет.

Загрузить файл вместо вас я не могу: для production Supabase нужен сервисный
ключ, а с секретами я не работаю.

## Планировщик фоновых задач — теперь в базе

С миграции `0057` очередь уведомлений (в том числе рассылку RFQ поставщикам)
и очередь обучения разбирает **сама база** через `pg_cron`, каждые 15 минут.
Расписание из GitHub Actions убрано.

**Почему.** Запуск в GitHub каждые 15 минут оплачивался как полная минута на
каждый из 96 запусков в сутки — около 2 880 минут в месяц при бесплатных
2 000. Одно это расписание исчерпывало лимит, после чего GitHub блокировал и
его, и проверки кода. Vercel Cron на бесплатном тарифе запускается не чаще раза
в сутки. `pg_cron` работает внутри Supabase и не тарифицируется поминутно.

### Что положить в Supabase Vault

Supabase → проект `qajet` → *Project Settings* → *Vault* → *Add new secret*.
Два секрета, имена — строго такие:

| Имя | Значение |
| --- | --- |
| `qajet_cron_secret` | **то же значение**, что `CRON_SECRET` в Vercel |
| `qajet_app_url` | `https://qajet-seven.vercel.app` (без слэша в конце — не страшно, но лишнее) |

Если значения `qajet_cron_secret` и `CRON_SECRET` в Vercel разойдутся,
задачи будут получать 401 и не выполнятся.

Пока секретов нет, планировщик **ничего не делает** — это не ошибка. Функция
`run_scheduled_jobs()` проверяет их наличие и тихо выходит, чтобы не засорять
очередь запросами, заведомо обречёнными на 401.

### Проверить, что работает

```sql
-- задание на месте
select jobname, schedule, active from cron.job where jobname = 'qajet-drain-queues';
-- последние срабатывания и их исход
select status, return_message, start_time
from cron.job_run_details order by start_time desc limit 5;
-- ответы приложения на запросы
select status_code, created from net._http_response order by created desc limit 5;
```

`CRON_SECRET` в секретах GitHub теперь нужен только для ручного запуска
workflow «Scheduled jobs».
