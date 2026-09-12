# Аудит и финиш QAJET — 12 сентября 2026

## Объём

Проверены и доведены repository-controlled части основного web/MVP-пути:

- standalone-запуск Playwright на Windows и публичный smoke;
- PII-восстановление и расчёт локальной/межгородской доставки;
- машина состояний заказа, RLS-границы, неизменяемый audit log и подтверждение доставки поставщиком;
- защищённый двухступенчатый ответ поставщика по RFQ без входа;
- owner-only приглашение менеджера покупателя;
- live-признаки матчера (загрузка и свежесть), обучение estimator по `itemKey` и
  сохранение обязательного `n_samples`;
- оценка закрытого заказа покупателем и транзакционный пересчёт
  `supplier_stats` по RFQ/КП/оценкам;
- dev-first очередь уведомлений RFQ с админским просмотром `/admin/outbox`;
- CI-предварительная проверка live E2E и документация;
- транзакционные server actions и защиту от прямых обходов жизненного цикла;
- полноту данных КП и остаточный AI-slop в коде/миграциях.

iOS/Android native-проекты в объём не входят по решению пользователя.

## Что сделано

1. `shipped → delivered` теперь доступен только назначенному поставщику. Для multi-supplier заказа последний поставщик переводит заказ в `delivered`; каждая фиксация хранится в `order_supplier_deliveries`.
2. `order_stage_events` больше не пишется из клиентского action. PostgreSQL AFTER-триггер создаёт audit row в той же транзакции, что и изменение `orders`; authenticated INSERT policy удалена.
3. Выплаты поставщикам используют уникальность `(order_id, supplier_company_id)` и conflict-safe upsert.
4. Публичный RFQ использует HMAC scope `rfq_respond`, TTL, nonce из строки RFQ и отдельные security-definer RPC для чтения, быстрого ответа, отказа и отправки КП. Неправильная/просроченная ссылка завершается 404, повторный ответ блокируется статусом RFQ.
5. Владелец buyer-компании может пригласить менеджера. Service-role клиент находится в server-only модуле и вызывается только после owner/buyer проверки; профиль `public.users` создаётся с ролью `manager`.
6. Playwright startup больше не зависит от Unix `cp`; public smoke вынесен в отдельную always-on CI job. Live E2E получает явный preflight и корректно пропускается с warning при отсутствии Supabase secrets.
7. README и экран команды больше не описывают уже реализованные маршруты как отсутствующие. Ограничения внешней инфраструктуры и native mobile оставлены явно.
8. Матчер получает число открытых заказов и дату последнего закрытого заказа из
   текущей БД; эти значения попадают в `selection_reason.features`, а не
   подменяются нейтральными константами.
9. Закрытие заказа добавляет ошибку оценки по всем его `itemKey`, сохраняет
   валидный estimator snapshot с `n_samples`, а следующая оценка использует
   накопленный P80-запас. Покупатель может оценить каждого исполнителя без
   раскрытия его имени; DB-функция проверяет заказ, план и повторную оценку.
10. RFQ-рассылка сохраняет уведомления в `outbox` как pending-записи с
    защищённой ссылкой, адресатом и trace-payload; `/admin/outbox` показывает
    статус, попытки и ошибку доставки. Реальный Resend-worker остаётся
    внешним подключаемым контуром и не является обязательным для демо.
11. Критические write-пути теперь транзакционные: создание заявки, intake,
    предложение плана и продвижение заказа выполняются через PostgreSQL RPC.
    Estimate, prepayment, RFQ, outbox, выплаты, документы и audit-событие не
    остаются сиротами, если следующий шаг не прошёл.
12. Приёмка заказа разрешена только покупателю, включая переход из `disputed`;
    консьерж больше не может закрыть поставочный спор от имени покупателя.
    Истечение `respond_by` проверяется и в публичном, и в авторизованном RFQ
    RPC, а также прямыми database-триггерами.
13. Входные числа на server actions валидируются как безопасные целые с
    корректными границами; лимит согласования не может быть отрицательным,
    отзыв сотрудника фиксирует `deactivated_at`, а split заявки проверяет
    сумму частей до записи.
14. Исправление классификации позиции обновляет связанно название, категорию,
    единицу, capabilities и `specs.itemKey`. Публичная и авторизованная форма
    КП передают setup fee и минимальную партию явно; пропуск сохраняется в
    `field_flags`, поэтому неполная строка не выглядит заполненной и не входит
    в исполнимый рекомендованный план.
15. Удалён неиспользуемый `ScreenLedger`, исправлены stale-комментарии и
    бессмысленное имя новой миграции `lame_loki` заменено на
    `0027_data_integrity_constraints`.

## Проверка в этой среде

- `corepack pnpm install --frozen-lockfile` — pass: lockfile актуален.
- `corepack pnpm lint` — pass, без warnings.
- `corepack pnpm typecheck` — pass.
- `corepack pnpm test` — pass: 218 тестов, 24 skipped; из них DB/RLS — 23 skipped, PD RLS — 1 skipped.
- `corepack pnpm --filter @qajet/web build` — pass: Next.js собрал 25 static pages; в сборку вошёл `/admin/outbox`, metadata base задан явно.
- `corepack pnpm --filter @qajet/web e2e` — pass: 8 passed, 3 skipped; public landing, startupbattle и fail-closed RFQ smoke проходят без Supabase.
- `corepack pnpm --filter @qajet/db test:rls` — выполнен без ошибок, 23 теста skipped из-за отсутствия `DATABASE_URL`.
- `corepack pnpm --filter @qajet/db db:generate` — pass: schema и migration snapshot синхронны, новых изменений не найдено.
- `corepack pnpm --filter @qajet/db exec drizzle-kit check` — pass.
- `git diff --check` — pass.
- `corepack pnpm rag:sync` / `corepack pnpm rag:check` — pass: 55 документов, индекс актуален.

## Подтверждение после GitHub/Vercel

- Будет добавлено после публикации текущего commit: свежий GitHub Actions run
  с PostgreSQL/RLS и свежий Vercel production smoke. Предыдущий run
  `34686363385` относится к предыдущему commit и не заменяет текущую проверку.

## Внешние gates

Следующие проверки нельзя честно заменить локальным кодом:

- применение миграций `0022`–`0027` к production Supabase и наличие
  production seed/live Auth — доступного `DATABASE_URL` или service-role
  ключа в этой сессии не было;
- live Supabase lifecycle с демо-аккаунтами и двуфазной доставкой;
- production Supabase schema/data, custom domain и реальные Resend/Storage/
  календарные провайдеры;
- production Resend-worker и реальная доставка писем: очередь уведомлений и
  её RLS проверены, внешний провайдер остаётся конфигурационным gate;
- размещение ПД в дата-центре Казахстана;
- сборка iOS/Android — намеренно исключена из задачи.

Эти пункты не объявляются выполненными на основании typecheck, unit tests или локального standalone smoke.
