# Release acceptance

Этот файл отделяет доказательство в коде от проверки конкретной среды. Публичный
HTTP `200`, успешный preview или наличие строки в `.env` не доказывают рабочий
вход, RLS, банковский перевод, почту или восстановление данных.

Контракты ниже сверены с кодом `d2e79f2`. Это не запись выполненной приёмки.
Исторические PASS в `readiness.json` или заметках другого SHA не переносятся
на текущий кандидат.

## Технический gate

Запуск из корня репозитория:

```bash
pnpm install --frozen-lockfile
pnpm release:check
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @qajet/web build
pnpm rag:sync
```

`pnpm release:check` без strict проверяет исходники/формат manifest и может
продолжить работу с отсутствующими env. Это не разрешение на выпуск. RLS и
живые сценарии выполняйте отдельно на выделенной локальной/staging-среде;
зелёный `pnpm test` без `DATABASE_URL` не подтверждает RLS.

Для strict gate нужен чистый checkout выпускаемого SHA, подключённая среда
секретов, целевое развёртывание и файл **реальных** доказательств вне checkout:

```bash
node tools/ci/check-release-readiness.mjs --strict \
  --ready-url=https://YOUR-DEDICATED-STAGING-HOST \
  --evidence=/tmp/qajet-release-evidence.json
```

Это шаблон команды для согласованной среды, а не выполненная проверка.
Строгий режим требует непустые обязательные env, в том числе `DATABASE_URL`,
`RESEND_API_KEY` и `RESEND_FROM_EMAIL`, не печатая их значения. Он проверяет
manifest со всеми обязательными gate, `sourceSha` и `gateSourceShas` текущего
релиза, а также JSON `/api/ready` с `ok: true`, `dependency: supabase` и тем же
40-символьным SHA. Redirect, HTML 200, `local` или другой commit не подходят.
Схема evidence и полный список gate: [release-evidence.md](../runbooks/release-evidence.md).
Не создавайте passed-метки вместо ещё не выполненных сценариев.
После `rag:sync` проверьте и сохраните нужные изменения до фиксации итогового
SHA: dirty checkout не пройдёт strict gate, а evidence должно относиться к
окончательной версии.

## Почта, scheduler и runtime readiness

- Resend не опционален для client release. В production отсутствие/пробельный
  ключ вызывает отказ адаптера до claim, а не доставку через оператора.
  Local sink разрешён кодом только вне production и не отправляет письмо.
  Retry в админке возвращает failed-строку в очередь, но сам её не отправляет.
- Runtime readiness требует восемь непустых env, успешное чтение settings,
  `environment_kind = clients` и валидные реквизиты оператора. Список и
  значения `dependency` при 503: [production-environment.md](../runbooks/production-environment.md#runtime-readiness-contract).
  Реквизиты предоставляет владелец настоящего юрлица; тестовые данные и
  прохождение форматного валидатора не заменяют подтверждение их достоверности.
- Readiness не проверяет Resend credentials/domain/delivery, Vault, расписание
  и фактическое исполнение jobs. Для почты нужен синтетический сценарий на
  согласованной среде с контролируемым получателем и проверкой доставки.
- Миграция `0057` задаёт pg_cron каждые 15 минут; отсутствие Vault-параметров
  приводит к тихому выходу. GitHub `jobs.yml` запускается только вручную и
  проверяет оба job независимо. Успех cron SQL или один HTTP 200 недостаточны:
  проверяйте `ok: true`, `failed: 0`, `retryUnconfirmed: 0` при наличии, а также
  обработку заранее подготовленных синтетических элементов, не пустой batch.
- Контрактные тесты scheduler намеренно откатывают очередь pg_net и не отправляют
  HTTP; без `DATABASE_URL` они пропускаются. Они не подтверждают живой запуск по расписанию. Учёт ошибок ручного
  workflow не является автоматическим production-alerting. Повторы learning
  и неопределённое завершение outbox проверяются отдельно, без предположения
  exactly-once или слепого повторного запуска всего batch.

## Матрица доказательств

| Возможность | Что проверяется кодом | Что всё ещё проверяется в среде |
| --- | --- | --- |
| Вход и приглашение | Auth callback, установка/восстановление пароля, active-user gate | Письмо приглашения и ссылка конкретного домена |
| Заявка и расчёт | Каталог, короткий/full-text intake, estimate, RFQ, deterministic combine | Новый аккаунт без seed и реальные реквизиты |
| Деньги | `payment_facts`, P80 предоплата, выплаты, settlement refund/surcharge/exact | Реальный банковский reference и сверка бухгалтером |
| Доступ | RLS, роли компании, назначение RFQ, приватные вложения | Два независимых пользователя на staging и negative checks через HTTP |
| Переписка | buyer/internal/supplier threads, сообщения, upload/download | Размеры/типы файлов, storage lifecycle и уведомления |
| Почта | production fail-closed, очередь/lease, provider idempotency key, безопасный job response | Sender/domain, принятие провайдером, доставка контролируемому адресату и отсутствие дублей |
| Обучение | очередь, lease/retry, snapshots, price observations, обработка ошибок | Параллельные workers, частичные повторы и фактическая задержка cron; атомарность повторного обучения не гарантирована |
| Эксплуатация | health/readiness, локальный bootstrap, ручной job/release workflow, standalone build | Применённая схема/0057, Vault, реальное исполнение jobs, backup/restore и alerting |
| Мобильный веб | responsive UI и keyboard/focus contracts | Реальные устройства/браузеры; native iOS/Android не входят в scope |

## Что нельзя отмечать выполненным без внешнего доказательства

- live Supabase E2E с четырьмя ролями и минимум двумя изолированными поставщиками;
- применение миграций именно в production и совпадение SHA приложения со схемой;
- резервное копирование и восстановление DB/Auth/private storage в отдельную среду;
- соответствие хранения персональных данных требованиям РК;
- первый реальный заказ, перевод, доставка, приёмка и закрывающий документ;
- реальная доставка почты и исполнение обоих worker-ов по настроенному расписанию.

Пока обязательные gate не подтверждены для выпускаемого SHA и целевой среды,
выпуск заблокирован. Перечисляйте конкретные PASS и оставшиеся `NOT RUN`;
не называйте кандидат готовым к клиентскому пилоту только по локальным тестам.
