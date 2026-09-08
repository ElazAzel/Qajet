/**
 * Completeness — проверка «достаточно ли данных, чтобы отправить RFQ»,
 * agents.md §7.4/§8. Вызывается сервером до рассылки RFQ, не только
 * рисуется в интерфейсе — иначе гейт можно обойти прямым вызовом.
 *
 * Блокер на отсутствие `deadlineDate` — не декоративная строгость:
 * `loadRequestComparison()` (apps/web/app/lib/comparison.ts) без него
 * молча подставляет «сегодня», и `combine()` бракует любое КП как
 * `deadline_exceeded` — заказ без срока технически проходит RFQ, но
 * дальше не может получить ни одного допустимого варианта, и причина
 * этого невидима на экране сравнения. Дешевле остановить на шаг раньше
 * с понятной причиной, чем потом разбирать «почему все КП отклонены».
 *
 * Отсутствие `budgetKzt`, наоборот, НЕ блокер: matcher уже трактует
 * неизвестный бюджет как «нет фильтра по минимальной партии»
 * (`Number.POSITIVE_INFINITY` в match.ts) — это осознанное поведение,
 * не пробел, поэтому здесь только предупреждение.
 */

export interface CompletenessIssue {
  code: string;
  humanReason: string;
}

export interface CompletenessResult {
  blockers: CompletenessIssue[];
  warnings: CompletenessIssue[];
}

export interface CompletenessItemInput {
  id: string;
  name: string;
  needsClarification: boolean;
  clarificationReason: string | null;
}

export interface CompletenessInput {
  deadlineDate: string | null;
  budgetKzt: number | null;
  items: CompletenessItemInput[];
}

export function checkRequestCompleteness(input: CompletenessInput): CompletenessResult {
  const blockers: CompletenessIssue[] = [];
  const warnings: CompletenessIssue[] = [];

  if (!input.deadlineDate) {
    blockers.push({
      code: 'missing_deadline',
      humanReason:
        'Не указана дата дедлайна — без неё сравнение предложений отбракует любое КП по сроку.',
    });
  }

  for (const item of input.items) {
    if (item.needsClarification) {
      blockers.push({
        code: 'item_needs_clarification',
        humanReason: `«${item.name}»: ${item.clarificationReason ?? 'требуется уточнение перед RFQ'}`,
      });
    }
  }

  if (input.budgetKzt === null) {
    warnings.push({
      code: 'missing_budget',
      humanReason:
        'Бюджет не указан — подбор поставщиков продолжит работать без ограничения по минимальной партии.',
    });
  }

  return { blockers, warnings };
}
