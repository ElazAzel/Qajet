# Аудит и финиш QAJET — 12 сентября 2026

## Объём

Проверены и доведены repository-controlled части основного web/MVP-пути:

- standalone-запуск Playwright на Windows и публичный smoke;
- PII-восстановление и расчёт локальной/межгородской доставки;
- машина состояний заказа, RLS-границы, неизменяемый audit log и подтверждение доставки поставщиком;
- защищённый двухступенчатый ответ поставщика по RFQ без входа;
- owner-only приглашение менеджера покупателя;
- CI-предварительная проверка live E2E и документация.

iOS/Android native-проекты в объём не входят по решению пользователя.

## Что сделано

1. `shipped → delivered` теперь доступен только назначенному поставщику. Для multi-supplier заказа последний поставщик переводит заказ в `delivered`; каждая фиксация хранится в `order_supplier_deliveries`.
2. `order_stage_events` больше не пишется из клиентского action. PostgreSQL AFTER-триггер создаёт audit row в той же транзакции, что и изменение `orders`; authenticated INSERT policy удалена.
3. Выплаты поставщикам используют уникальность `(order_id, supplier_company_id)` и conflict-safe upsert.
4. Публичный RFQ использует HMAC scope `rfq_respond`, TTL, nonce из строки RFQ и отдельные security-definer RPC для чтения, быстрого ответа, отказа и отправки КП. Неправильная/просроченная ссылка завершается 404, повторный ответ блокируется статусом RFQ.
5. Владелец buyer-компании может пригласить менеджера. Service-role клиент находится в server-only модуле и вызывается только после owner/buyer проверки; профиль `public.users` создаётся с ролью `manager`.
6. Playwright startup больше не зависит от Unix `cp`; public smoke вынесен в отдельную always-on CI job. Live E2E получает явный preflight и падает с actionable GitHub notice при отсутствии Supabase secrets.
7. README и экран команды больше не описывают уже реализованные маршруты как отсутствующие. Ограничения внешней инфраструктуры и native mobile оставлены явно.

## Проверка в этой среде

- `corepack pnpm install --frozen-lockfile` — pass.
- `corepack pnpm lint` — pass, без warnings.
- `corepack pnpm typecheck` — pass.
- `corepack pnpm test` — pass: 205 тестов, 22 skipped; из них DB/RLS — 21 skipped, PD RLS — 1 skipped.
- `corepack pnpm --filter @qajet/web build` — pass: Next.js собрал 24 static pages; metadata base задан явно.
- `corepack pnpm --filter @qajet/web e2e` — pass: 8 passed, 3 skipped; public landing, startupbattle и fail-closed RFQ smoke проходят без Supabase.
- `corepack pnpm --filter @qajet/db test:rls` — выполнен без ошибок, 21 тест skipped из-за отсутствия `DATABASE_URL`.
- `corepack pnpm --filter @qajet/db exec drizzle-kit check` — pass.
- `corepack pnpm rag:check` — pass: индекс актуален.

## Внешние gates

Следующие проверки нельзя честно заменить локальным кодом:

- реальный PostgreSQL/Supabase RLS прогон (`DATABASE_URL` или CI Postgres);
- live Playwright lifecycle с демо-аккаунтами и двуфазной доставкой;
- production secrets, домен, deployment и реальные Resend/Storage/календарные провайдеры;
- размещение ПД в дата-центре Казахстана;
- сборка iOS/Android — намеренно исключена из задачи.

Эти пункты не объявляются выполненными на основании typecheck, unit tests или локального standalone smoke.
