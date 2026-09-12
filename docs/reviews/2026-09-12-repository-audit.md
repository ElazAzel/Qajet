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
- CI-предварительная проверка live E2E и документация.

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

## Проверка в этой среде

- `corepack pnpm install --frozen-lockfile` — pass.
- `corepack pnpm lint` — pass, без warnings.
- `corepack pnpm typecheck` — pass.
- `corepack pnpm test` — pass: 212 тестов, 23 skipped; из них DB/RLS — 22 skipped, PD RLS — 1 skipped.
- `corepack pnpm --filter @qajet/web build` — pass: Next.js собрал 24 static pages; metadata base задан явно.
- `corepack pnpm --filter @qajet/web e2e` — pass: 8 passed, 3 skipped; public landing, startupbattle и fail-closed RFQ smoke проходят без Supabase.
- `corepack pnpm --filter @qajet/db test:rls` — выполнен без ошибок, 22 теста skipped из-за отсутствия `DATABASE_URL`.
- `corepack pnpm --filter @qajet/db exec drizzle-kit check` — pass.
- `corepack pnpm rag:check` — pass: индекс актуален.

## Подтверждение после GitHub/Vercel

- GitHub Actions run `34683450434` — pass: lint/typecheck, unit tests, build,
  public smoke, real PostgreSQL/RLS isolation (22 теста), PD RLS и RAG
  freshness. Live Supabase E2E — skipped с warning,
  потому что в репозитории не заданы `NEXT_PUBLIC_SUPABASE_URL` и
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` secrets.
- GitHub `main` синхронен с `origin/main`; Vercel автоматически получает
  изменения из этой ветки.
- Текущий Vercel production deployment — `READY`, алиас
  [qajet-seven.vercel.app](https://qajet-seven.vercel.app/); smoke: `/` — 200,
  `/startupbattle` — 200, некорректный `/rfq/respond/not-a-token` — 404.
- В production Vercel заданы `NEXT_PUBLIC_SITE_URL` и чувствительный
  `LINK_SIGNING_SECRET`; значения секретов в репозиторий и отчёт не попали.

## Внешние gates

Следующие проверки нельзя честно заменить локальным кодом:

- применение миграций `0022`/`0023`/`0024` к production Supabase и наличие
  production seed/live Auth — доступного `DATABASE_URL` или service-role
  ключа в этой сессии не было;
- live Supabase lifecycle с демо-аккаунтами и двуфазной доставкой;
- production Supabase schema/data, custom domain и реальные Resend/Storage/
  календарные провайдеры;
- размещение ПД в дата-центре Казахстана;
- сборка iOS/Android — намеренно исключена из задачи.

Эти пункты не объявляются выполненными на основании typecheck, unit tests или локального standalone smoke.
