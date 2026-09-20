# Опись SECURITY DEFINER-функций

Сгенерировано `pnpm --filter @qajet/db db:inventory` по каталогу локальной БД (53 применённых миграций). Не редактировать руками: правки пропадут.

Здесь только то, что можно измерить. **Не измеряется**: достаточна ли проверка внутри тела и почему нужен именно `SECURITY DEFINER` (а не `SECURITY INVOKER`). Признак в теле — указатель, куда смотреть, а не доказательство корректности; функция, доступная `authenticated` и без признаков, — повод для ручного разбора.

## Итоги

- всего SECURITY DEFINER: **63** (вызываемые RPC: **30**, триггерные: **33**)
- доступны `anon`: **4**
- доступны `authenticated`: **23**
- только `service_role`: **7**
- без закреплённого `search_path`: **0**
- вызываемые без единого теста, упоминающего имя: **4**
- вызываемые для `authenticated` без признаков проверки актёра: **4** (см. отметку ⚠ ниже)
- триггерные функции, доступные `anon` или `authenticated`: **0**

## Вызываемые RPC

| Функция | anon | authenticated | service_role | search_path | признаки проверки в теле | упоминают тесты | разбор вручную (2026-09-20) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `approve_plan(p_order_id uuid, p_expected_plan_id uuid, p_expected_plan_version integer)` | — | да | да | `''` | auth.uid() | function-privileges, order-write-guard, plan-change-request, plan-lines-commission, platform-integrity |  |
| `assign_order_concierge(p_order_id uuid, p_concierge_user_id uuid)` | — | да | да | `''` | auth.uid() | privileged-rpc-authorization |  |
| `assign_supplier_rfq(p_rfq_id uuid, p_supplier_user_id uuid)` | — | да | да | `''` | auth.uid() | privileged-rpc-authorization |  |
| `buyer_company_ids_for_current_supplier()` | — | да | да | `''` | — ⚠ | plan-change-request | делегирует supplier_can_access_rfq, а тот опирается на auth.uid(); собственной проверки не нужно |
| `claim_learning_events(p_limit integer, p_lease_id text)` | — | — | да | `''` | role=service_role | queue-rpc-authorization |  |
| `claim_outbox_batch(p_limit integer, p_lease_id text)` | — | — | да | `''` | role=service_role | queue-rpc-authorization |  |
| `complete_learning_event(p_id uuid, p_lease_id text)` | — | — | да | `''` | role=service_role | queue-rpc-authorization |  |
| `complete_outbox(p_id uuid, p_lease_id text, p_provider_message_id text)` | — | — | да | `''` | role=service_role | queue-rpc-authorization |  |
| `confirm_supplier_delivery(p_order_id uuid)` | — | да | да | `''` | auth.uid() | function-privileges, order-write-guard, platform-integrity |  |
| `current_company_id()` | — | да | да | `''` | auth.uid() | function-privileges, plan-change-request |  |
| `current_role()` | — | да | да | `''` | auth.uid() | plan-change-request, staff-history-survives-turnover |  |
| `decline_rfq_public(p_rfq_id uuid, p_token text)` | да | да | да | `''` | token | function-privileges, public-rfq-access |  |
| `decline_supplier_rfq(p_rfq_id uuid)` | — | да | да | `''` | current_company_id() | privileged-rpc-authorization |  |
| `fail_learning_event(p_id uuid, p_lease_id text, p_error text)` | — | — | да | `''` | role=service_role | queue-rpc-authorization |  |
| `fail_outbox(p_id uuid, p_lease_id text, p_error text)` | — | — | да | `''` | role=service_role | queue-rpc-authorization |  |
| `get_buyer_rating_targets(p_order_id uuid)` | — | да | да | `''` | auth.uid() | platform-integrity |  |
| `get_rfq_quick_response(p_rfq_id uuid, p_token text)` | да | да | да | `''` | token | function-privileges, public-rfq-access |  |
| `is_staff_user(p_user_id uuid)` | — | да | да | `''` | — ⚠ | **нет** | P3: любой вошедший может спросить, является ли произвольный UUID сотрудником QAJET; нужна RLS-политикам для чужих user_id, SECURITY DEFINER — чтобы читать users в обход RLS; эксплуатация требует знать UUID |
| `quick_respond_rfq_public(p_rfq_id uuid, p_token text)` | да | да | да | `''` | token | function-privileges, public-rfq-access |  |
| `refresh_supplier_stats(p_supplier_company_id uuid)` | — | — | да | `''` | — | queue-rpc-authorization |  |
| `request_supplier_quote_revision(p_rfq_id uuid, p_note text)` | — | да | да | `''` | auth.uid(), current_role() | privileged-rpc-authorization |  |
| `rfq_request_ids_for_current_supplier()` | — | да | да | `''` | — ⚠ | plan-change-request | делегирует supplier_can_access_rfq (auth.uid()); собственной проверки не нужно |
| `select_order_plan(p_order_id uuid, p_expected_plan_id uuid, p_plan_id uuid)` | — | да | да | `''` | auth.uid() | function-privileges, privileged-rpc-authorization |  |
| `set_team_member_access(p_user_id uuid, p_approval_limit_kzt bigint, p_is_active boolean)` | — | да | да | `''` | auth.uid() | plan-change-request |  |
| `submit_rfq_public(p_rfq_id uuid, p_token text, p_lines jsonb)` | да | да | да | `''` | token | function-privileges, public-rfq-access |  |
| `submit_supplier_quote(p_rfq_id uuid, p_lines jsonb)` | — | да | да | `''` | auth.uid(), current_role(), current_company_id() | platform-integrity |  |
| `submit_supplier_rating(p_order_id uuid, p_supplier_company_id uuid, p_buyer_score integer, p_was_on_time boolean, p_had_dispute boolean, p_comment text)` | — | да | да | `''` | auth.uid() | platform-integrity |  |
| `supplier_can_access_order(p_order_id uuid)` | — | да | да | `''` | auth.uid() | **нет** | проверяется косвенно через RLS-политики (supplier-isolation, attachment-isolation), по имени в тестах не упомянута |
| `supplier_can_access_plan_line(p_plan_id uuid, p_supplier_company_id uuid)` | — | да | да | `''` | — ⚠ | **нет** | итоговый предикат — supplier_can_access_order (auth.uid()); чужому вызывающему отдаёт false, произвольный supplier_company_id сам по себе ничего не раскрывает |
| `supplier_can_access_rfq(p_rfq_id uuid)` | — | да | да | `''` | auth.uid() | **нет** | проверяется косвенно через RLS-политики (supplier-isolation), по имени в тестах не упомянута |

## Триггерные функции

Ни одна не должна быть доступна `anon` или `authenticated` (миграции 0042 и 0052, тест `function-privileges`). Выполняются только как триггеры. Всего: 33; открытых: 0.

`aggregate_plan_commission`, `assign_supplier_response_user`, `audit_order_stage_transition`, `enforce_order_transition`, `enqueue_order_learning_event`, `ensure_order_conversation_threads`, `ensure_order_supplier_threads_on_plan_change`, `ensure_order_threads`, `ensure_plan_line_supplier_thread`, `ensure_request_conversation_threads`, `ensure_request_threads`, `ensure_rfq_thread`, `guard_approved_plan`, `guard_concierge_assignment`, `guard_order_actor`, `guard_order_financial_facts`, `guard_paid_obligation`, `guard_payment_fact`, `guard_payment_fact_immutability`, `guard_payment_idempotency`, `guard_plan_aggregate_contract`, `guard_plan_line_commission`, `guard_plan_line_contract`, `guard_plan_reconciliation`, `guard_prepaid_payment_contract`, `guard_request_item_stage`, `guard_supplier_payout_summary`, `guard_supplier_payout_total`, `guard_time_entry_total`, `refresh_supplier_stats_after_quote`, `refresh_supplier_stats_after_rating`, `refresh_supplier_stats_after_rfq`, `sync_closed_request_status`

Замечание: сюда попадают только триггерные функции `SECURITY DEFINER`. Триггерные функции `SECURITY INVOKER` в опись не входят, но закрыты той же миграцией 0052 и тем же тестом.

