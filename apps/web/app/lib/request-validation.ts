/**
 * Ошибки формы заявки по полям. Раньше любой сбой валидации превращался в
 * одну строку под кнопкой «Данные заявки указаны некорректно»: покупатель не
 * понимал, что именно исправлять, а фокус оставался на кнопке.
 *
 * Ключи совпадают с `name` полей формы, чтобы клиент мог поставить ошибку
 * рядом с полем, отметить его `aria-invalid` и перевести на него фокус.
 */

export type RequestField =
  | 'title'
  | 'city'
  | 'description'
  | 'budgetKzt'
  | 'deadlineDate'
  | 'deliveryAddress'
  | 'items';

export type RequestFieldErrors = Partial<Record<RequestField, string>>;

/** Порядок полей на странице сверху вниз — по нему выбирается «первое с ошибкой». */
export const REQUEST_FIELD_ORDER: readonly RequestField[] = [
  'title',
  'city',
  'items',
  'deadlineDate',
  'budgetKzt',
  'deliveryAddress',
  'description',
];

const MESSAGE: Record<RequestField, string> = {
  title: 'Введите название заявки',
  city: 'Укажите город доставки',
  description: 'Описание слишком длинное — не больше 5000 символов',
  budgetKzt: 'Бюджет — целое число тенге, не меньше нуля',
  deadlineDate: 'Укажите дату полностью',
  deliveryAddress: 'Адрес слишком длинный — не больше 500 символов',
  items: 'Добавьте хотя бы одну позицию',
};

interface IssueLike {
  path: readonly PropertyKey[];
  code?: string;
}

function isField(value: unknown): value is RequestField {
  return typeof value === 'string' && value in MESSAGE;
}

export function requestFieldErrors(issues: readonly IssueLike[]): RequestFieldErrors {
  const errors: RequestFieldErrors = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (!isField(field) || errors[field]) continue;
    if (field === 'items' && issue.path[1] !== undefined && issue.path[2] === 'qty') {
      errors.items = 'Количество должно быть целым числом больше нуля';
      continue;
    }
    errors[field] = MESSAGE[field];
  }
  return errors;
}

/** Срок «не в прошлом» — сервер сверяет с текущей датой в Алматы (UTC+5, без переходов). */
export function isDeadlineInPast(deadlineDate: string, now = new Date()): boolean {
  const almaty = new Date(now.getTime() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return deadlineDate < almaty;
}

export function firstFieldWithError(errors: RequestFieldErrors): RequestField | null {
  return REQUEST_FIELD_ORDER.find((field) => errors[field]) ?? null;
}
