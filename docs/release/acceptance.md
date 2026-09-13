# Release acceptance

Этот файл отделяет доказательство в коде от проверки конкретной среды. Публичный
HTTP `200`, успешный preview или наличие строки в `.env` не доказывают рабочий
вход, RLS, банковский перевод, почту или восстановление данных.

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

Для выпуска с подключённой средой секретов:

```bash
pnpm release:check -- --strict
```

Строгий режим проверяет наличие имён обязательных переменных, но не выводит их
значения. `RESEND_API_KEY` остаётся опциональным: без него письмо попадает в
outbox и может быть обработано оператором.

## Матрица доказательств

| Возможность | Что проверяется кодом | Что всё ещё проверяется в среде |
| --- | --- | --- |
| Вход и приглашение | Auth callback, установка/восстановление пароля, active-user gate | Письмо приглашения и ссылка конкретного домена |
| Заявка и расчёт | Каталог, короткий/full-text intake, estimate, RFQ, deterministic combine | Новый аккаунт без seed и реальные реквизиты |
| Деньги | `payment_facts`, P80 предоплата, выплаты, settlement refund/surcharge/exact | Реальный банковский reference и сверка бухгалтером |
| Доступ | RLS, роли компании, назначение RFQ, приватные вложения | Два независимых пользователя на staging и negative checks через HTTP |
| Переписка | buyer/internal/supplier threads, сообщения, upload/download | Размеры/типы файлов, storage lifecycle и уведомления |
| Обучение | очередь, lease/retry/idempotency, snapshots, price observations | Параллельный worker на staging и фактическая задержка cron |
| Эксплуатация | health/readiness, локальный bootstrap, release workflow, standalone build | Docker daemon, production schema, backup/restore и alerting |
| Мобильный веб | responsive UI и keyboard/focus contracts | Реальные устройства/браузеры; native iOS/Android не входят в scope |

## Что нельзя отмечать выполненным без внешнего доказательства

- live Supabase E2E с четырьмя ролями и минимум двумя изолированными поставщиками;
- применение миграций именно в production и совпадение SHA приложения со схемой;
- резервное копирование и восстановление DB/Auth/private storage в отдельную среду;
- соответствие хранения персональных данных требованиям РК;
- первый реальный заказ, перевод, доставка, приёмка и закрывающий документ;
- реальная доставка почты и ежедневный запуск worker-ов.

Если эти проверки ещё не проведены, итоговый статус — «технически готов к
пилоту с внешними gate», а не «подтверждено в эксплуатации».
