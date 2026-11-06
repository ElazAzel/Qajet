# Runtime configuration and job verification

These instructions describe the source contract in the reviewed checkout.
Verify the exact reviewed commit against the selected runtime before using
them. This documentation update did not inspect production configuration or
execute a release check. September observations in [baseline.md](../qa/baseline.md) and
[readiness.json](../release/readiness.json) are historical evidence for their
recorded environments and SHAs, not a current inventory or approval.

Choose the authorized target environment before configuring or invoking jobs.
Use a dedicated local/staging environment and synthetic, controlled recipients
for acceptance. Configuration, deployment and real sending require their own
approved operational steps. Ongoing operations are in [operations.md](./operations.md).

Secret **names** are not secret. Never put secret **values** in a commit, log,
chat, screenshot, ticket or evidence file. Use the platform's secure settings.

## Recorded project identifiers

These identify the earlier deployment discussed in the historical notes. They
do not establish that it is suitable for client data or that its current
configuration matches the code. Do not silently use it as the acceptance target.

| Thing | Recorded identifier |
| --- | --- |
| Vercel project | `qajet` (team `elazazels-projects`) |
| Supabase project | `qajet`, ref `eoqcktgvnzayyinulbch`, region `ap-southeast-1` |
| Existing URL | `https://qajet-seven.vercel.app` |
| GitHub repository | `ElazAzel/Qajet` |

No fresh inventory of Vercel environment variables, GitHub secrets or Supabase
Vault was performed for this documentation change.

## Runtime readiness contract

[`/api/ready`](../../apps/web/app/api/ready/route.ts) requires all eight values
to be present and nonblank in the **running application**:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SITE_URL`
- `LINK_SIGNING_SECRET`
- `CRON_SECRET`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`

It then reads `settings` through the server-only admin client and requires
`environment_kind = "clients"` and valid `qajet_requisites`. The operator must
supply genuine, authorized legal-entity details; do not invent them or reuse
demo/test values to turn this gate green. The validator checks the implemented
format/content rules, not ownership of a bank account, legal approval or data
residency compliance.

| Response | What the code established |
| --- | --- |
| 503, `dependency: "env"` | At least one required value is blank/missing; `missing` lists names only. |
| 503, `dependency: "client_configuration"` | Settings are readable but the client marker or requisites fail validation. |
| 503, `dependency: "supabase"` | The settings read/client operation failed; the response hides provider details. |
| 200, `ok: true`, `dependency: "supabase"` | The above runtime configuration checks passed; the response includes a commit and timestamp. |

Readiness does not inspect Vault, the pg_cron schedule, HTTP job execution,
Resend credentials/domain/delivery, a full migration chain, RLS, backup restore
or legal compliance. Most environment checks establish nonblank presence, not
that a credential works with its provider. `/api/health` is a separate process
check. Neither endpoint alone approves release.

The strict CLI additionally requires `DATABASE_URL` in its own environment,
a clean checkout, reviewed evidence tied to its SHA and a matching deployed
readiness JSON response. Runtime `/api/ready` itself does not require
`DATABASE_URL`. A commit of `local`, an absent commit or a different SHA cannot
pass strict acceptance. See [release-evidence.md](./release-evidence.md).

## 1. Supabase service access

`SUPABASE_SERVICE_ROLE_KEY` is one required value, not a promise that adding it
alone will make readiness pass. Check the complete contract above.

Obtain the selected project's server service-role credential through Supabase's
secure settings, not its public anon key. Set it in the corresponding server
runtime. It bypasses RLS: never put it in `NEXT_PUBLIC_*`, browser code or a
shared preview that points at production data. Preview validation needs a
separate approved test project. Deploy the intended SHA/configuration and then
verify that the running application actually uses it.

## 2. Cron authentication and target

Migration `0057` defines the database scheduler. When applied with its required
extensions and Vault support, it registers a 15-minute pg_cron job. The source
file does not prove it is applied or active in any particular environment.

The endpoint bearer secret must agree between:

- Runtime `CRON_SECRET` in the selected application.
- Vault `qajet_cron_secret` in its Supabase project.
- Repository secret `CRON_SECRET`, only if the manual GitHub workflow is used.

Vault `qajet_app_url` selects the database scheduler's target. The manual
workflow instead uses repository variable `APP_URL`, falling back to the
existing hardcoded deployment URL when it is absent. Confirm both targets;
setting a local shell variable does not configure either remote path. Coordinate
any approved rotation across the paths actually in use without exposing values.

Job authorization requires exact `Authorization: Bearer …` syntax. Missing or
blank runtime `CRON_SECRET` fails closed in every environment, not just
production. A missing Vault value instead makes the scheduler silently do no
work; see the final scheduler section.

## 3. Explicit Resend configuration

For client readiness and strict release, **both** `RESEND_API_KEY` and
`RESEND_FROM_EMAIL` are mandatory. Obtain credentials and a sender authorized
for the selected Resend account/domain, configure them securely, then test on
the approved environment with a controlled recipient. Presence checks do not
verify the account, domain, quota or recipient delivery.

The low-level adapter still uses `QAJET <onboarding@resend.dev>` when
`RESEND_FROM_EMAIL` is unset. An empty string does not select that fallback.
This implementation fallback does not satisfy the explicit sender required by
readiness and strict release; it is not a supported shortcut for client launch.

## 4. Current mail behavior and its limits

[`createEmailAdapter()`](../../apps/web/app/lib/notifications/email-adapter.ts)
uses Resend whenever the trimmed key is nonempty. With no key, it throws when
`NODE_ENV=production`; only other environments use `LocalSinkAdapter`.
This is a runtime condition, not a branch name or a promise about a deployed SHA.

The [dispatcher](../../apps/web/app/lib/notifications/dispatcher.ts) constructs
the adapter before claiming rows. Therefore a missing production key makes an
authorized outbox invocation return 503 without changing queued rows or spending
their attempts. The nonproduction local sink sends no external mail but can complete queue rows.
A nonproduction environment with a real key can send actual mail.

Each outbox invocation claims one batch of up to 20 items, not the entire queue.
Resend success requires a successful HTTP response and provider message ID;
queue completion after that is not evidence of arrival in a recipient inbox.
Even outbox timestamps named `sent_at` or `delivered_at` must not substitute for
a controlled delivery check. The adapter supplies an idempotency key, but this
alone does not prove duplicate-free retries or recipient delivery.

The admin Retry action only returns a failed row to pending. It does not send
mail or bypass missing configuration. Check uncertain provider acceptance
before requeuing. The adapter has no explicit fetch timeout/throttling or
Retry-After handling. Outbox reports `retryUnconfirmed` when its failure-state
RPC errors or does not confirm the transition; later rows still run. This count
does not trigger an automatic resend or prove a retry was scheduled. Do not
infer guaranteed retry, exactly-once delivery or a service quota from this code.

---

## Verification — in this order

First verify the full runtime configuration and selected deployment. The
commands below are instructions, not an execution record. Set a dedicated
approved target; do not default an acceptance probe to the historical demo URL:

```bash
APP_URL=https://YOUR-DEDICATED-STAGING-HOST
curl -sS -o /dev/null -w '%{http_code}\n' "$APP_URL/api/ready"
```

Read the JSON as well as the status. At 503, `dependency` distinguishes env,
client configuration and Supabase failure; only the env response includes a
`missing` list. At 200, compare the returned commit with the reviewed release
SHA. Never log secret values or unfiltered provider diagnostics:

```bash
curl -sS "$APP_URL/api/ready"
```

Only after authorizing the test batch and checking repository `APP_URL` and
`CRON_SECRET`, run the manual workflow at the reviewed ref. It executes worker
operations, so use synthetic queued items and controlled recipients. A shell
`APP_URL` above does not override the repository variable used by Actions:

```bash
gh workflow run "Scheduled jobs" --ref=YOUR-REVIEWED-REF
```

Locate the run created by **this dispatch** and retain its run ID and URL.
Check the `workflow_dispatch` event, reviewed ref and full head SHA, initiating
account and dispatch time. Do not use an unqualified "latest run" as evidence:
a parallel or unrelated dispatch can appear first. If it cannot be identified
unambiguously, record the verification as unresolved. Inspect the selected run:

```bash
gh run view YOUR-RUN-ID --json databaseId,headSha,headBranch,event,createdAt,status,conclusion,url
```

Both jobs are attempted once, even if the first fails. A successful manual run
requires HTTP 200 **and** JSON `ok: true`, numeric `failed: 0`, and, when present,
numeric `retryUnconfirmed: 0` for both. HTTP, network, JSON or batch failures make
the final workflow fail after both attempts. An unavailable readiness gate is
`NOT RUN` and also fails the workflow without dispatching either job. Response
bodies are not printed. No automatic HTTP retries are added.
The manual workflow's readiness preflight checks the HTTP status only. It does
not compare the running application's SHA with the workflow ref; use the
separate readiness/SHA verification and strict gate for that requirement.

The endpoint response contract keeps HTTP 200 for a returned batch. `ok: false`
means one or more item failures or an unconfirmed retry transition; it does not
mean all items failed or that a retry was scheduled. Counts retain their names:
`claimed`, `sent` or `processed`, `failed`, and learning's `retryUnconfirmed`.
`errors` remains a string array, but its entries are safe `job.item_failed`
markers, not raw provider diagnostics. Its length is not a failed-item count:
one learning event can produce two diagnostics. A failed batch includes an
opaque `supportId` linked to one safe server log entry. Unauthorized requests
remain 401, and a thrown dispatcher error remains 503 with a safe support ID.

Neither 503 nor a timeout proves that no work committed. Do not blindly replay
a batch: learning stages are still non-atomic, and outbox completion can be
uncertain after provider acceptance. The queue's existing lease/backoff rules
are unchanged; this patch does not prove exactly-once delivery or learning.

Then observe one natural 15-minute tick. The database scheduler enqueues both
requests asynchronously and does **not** inspect their responses. Check actual
responses and queue state separately: a successful cron invocation or HTTP 200
alone does not prove successful item processing. This change does not add
automatic production alerting, change pg_cron or configure any provider.

Mail is **not** verified by any of the above. Verifying it means sending one
synthetic RFQ to a controlled test recipient and confirming the message actually
arrives — enqueue, drained by the scheduler, provider accepted, delivery state
recorded, retry safe, no duplicate. An outbox row reaching `sent` is not evidence
of delivery.

---

## External checks and historical context

- **Auth hardening.** Historical observations reported disabled built-in
  leaked-password protection. Recheck the selected project's current policy;
  this documentation update did not inspect or change it.
- **Data residency.** The recorded deployment used `ap-southeast-1`
  (Singapore). Confirm the actual target infrastructure and obtain the required
  owner/legal decision before real personal data. No legal approval is supplied
  by readiness or by this documentation update.
- **Backup and restore.** A backup that has never been restored is not verified.

## Защита от утёкших паролей без платного тарифа

Исторические заметки описывали встроенную защиту Supabase
(`auth_leaked_password_protection`) как выключенную. Текущее состояние проекта
и условия тарифа здесь не перепроверены. Вместо неё в приложении
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

[Миграция 0057](../../packages/db/migrations/0057_scheduled_jobs_in_database.sql)
регистрирует `qajet-drain-queues` с `*/15 * * * *` и функцией
`public.run_scheduled_jobs()`. Это описание SQL, не доказательство его
применения или успешной работы в выбранной среде.

[GitHub workflow](../../.github/workflows/jobs.yml) имеет только ручной
`workflow_dispatch`; автоматического расписания там нет. Не добавляйте второй
scheduler как предполагаемый обязательный шаг настройки.

### Что требуется в Vault

Через защищённые настройки согласованного Supabase-проекта задаются:

| Имя | Назначение |
| --- | --- |
| `qajet_cron_secret` | То же значение, что runtime `CRON_SECRET`, без случайных пробелов. |
| `qajet_app_url` | Проверенный URL приложения, работающего с этим проектом. |

При отсутствии/пустом значении любого из них функция тихо возвращается, не
ставя HTTP-запросы. Это unconfigured/NOT RUN, даже если cron SQL завершился
успешно. `/api/ready` не читает Vault и может не обнаружить эту проблему.

При наличии конфигурации `pg_net` ставит POST для outbox и learning с таймаутом
30 секунд. Запросы отправляются асинхронно после commit. Функция не вызывает
`/api/ready`, не анализирует HTTP/JSON результаты и не сообщает о partial
failure. Несовпадение bearer-секрета даст 401 на endpoint. Timeout не отменяет
уже выполненную работу приложения и не разрешает слепой повтор batch.

### Проверка без подмены доказательств

Следующие read-only запросы показывают конфигурацию и диагностические записи;
не запускайте их как доказательство выполненной приёмки без сохранённого
результата из нужной среды:

```sql
select jobname, schedule, active
from cron.job where jobname = 'qajet-drain-queues';
select status, return_message, start_time
from cron.job_run_details
where jobid in (select jobid from cron.job where jobname = 'qajet-drain-queues')
order by start_time desc limit 5;
select id, status_code, created
from net._http_response order by created desc limit 5;
```

Последние HTTP-строки могут относиться к другим запросам. Сама функция не
сохраняет возвращаемые `net.http_post` request IDs, поэтому эти выборки сами по
себе не связывают ответ с конкретным job. Для приёмки нужны результаты обоих
worker-ов и состояние принадлежащих проверке синтетических элементов после
фактического срабатывания расписания. Успех SQL, HTTP 200 или пустой batch не
подтверждает обработку сообщения, доставку почты или обучение.

`scheduled-jobs.test.ts` проверяет контракты БД и откатывает поставленные
pg_net-запросы, чтобы HTTP не ушли. Без `DATABASE_URL` этот набор пропускается.
Его результаты нельзя выдавать за живое исполнение scheduler.

Точная схема release evidence приведена в [release-evidence.md](./release-evidence.md).
Исторический tracked manifest не переименовывается в passed для новой версии;
в этом обновлении ни один внешний gate не объявлен выполненным.
