<!-- Сгенерировано `pnpm rag:sync`. Не редактировать руками — правки потеряются при следующей синхронизации. Источник фактов: файловая система репозитория. -->

# Реестр состояния QAJET

Инвентаризация кода, а НЕ отчёт о готовности. Здесь видно только то, что
можно установить по файловой системе: существуют ли подтверждающие пути.

Четыре уровня доказательства — разные вещи, и один не следует из другого:

```
ФАЙЛ СУЩЕСТВУЕТ → IMPLEMENTATION PRESENT → VERIFIED → PRODUCTION OPERATIONAL
```

Этот файл никогда не поднимается выше `IMPLEMENTATION PRESENT`. Наличие
роута или модуля не означает, что функция работает, покрыта тестами или
доступна в production. `VERIFIED` и `EXTERNAL BLOCKER` фиксируются только
в `docs/release/readiness.json` по факту реально выполненных проверок.

| Фаза | Что это | Найдено путей | Уровень |
| --- | --- | --- | --- |
| 0 | Фундамент: монорепо, токены, оболочки, PWA, RAG | 4/4 | `IMPLEMENTATION PRESENT` |
| 1 | Данные и доступ: схема Drizzle, RLS, Supabase Auth | 2/2 | `IMPLEMENTATION PRESENT` |
| 2 | Движок: estimate, match, combine, leadtime, tax | 2/2 | `IMPLEMENTATION PRESENT` |
| 3 | Сид: демо-данные, 15 поставщиков, 24 заказа | 1/1 | `IMPLEMENTATION PRESENT` |
| 4 | Сквозная вертикаль консьержа + экран сравнения | 1/1 | `IMPLEMENTATION PRESENT` |
| 5 | Остальные роли целиком (покупатель, поставщик, админ) | 2/2 | `IMPLEMENTATION PRESENT` |
| 6 | Измеримость и право: /metrics, /admin/learning, PII | 3/3 | `IMPLEMENTATION PRESENT` |
| 7 | Нативные оболочки и полировка: Tauri, Capacitor | 2/2 | `IMPLEMENTATION PRESENT` |
| 8 | Переносимость: docker-compose, runbook переезда | 1/1 | `IMPLEMENTATION PRESENT` |

## Открытые решения без реализации

- Казахстанский ДЦ для персональных данных (agents.md §11.1) — `packages/pd` спроектирован под это, бэкенд не переключён.
