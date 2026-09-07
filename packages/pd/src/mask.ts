/**
 * Маскирование перед внешними моделями — agents.md §11.2.
 *
 * «Если фича-флаг FEATURE_LLM_ASSIST включён — обязательный проход
 * maskPII(): имена, телефоны, адреса, email заменяются на идентификаторы
 * вида EMPLOYEE_148, PHONE_03, и обратная подстановка после ответа. Без
 * маскирования вызов невозможен архитектурно: функция вызова принимает
 * только тип MaskedPayload.»
 *
 * Имена и адреса не детектируются автоматически (NER на RU/KZ без
 * внешней модели ненадёжен и сам по себе противоречил бы §2 «никаких
 * вызовов LLM в рантайме») — их подставляет вызывающий код как
 * `knownEntities`, потому что он и так знает эти значения из структуры
 * заявки (users.fullName, requests.deliveryAddress и т.п.), а не угадывает
 * их из свободного текста. Телефоны и email распознаются регулярками
 * дополнительно — они статистически надёжно детектируются по форме.
 */

export type PiiEntityType = 'name' | 'phone' | 'email' | 'address';

export interface PiiEntity {
  type: PiiEntityType;
  value: string;
}

const TOKEN_PREFIX: Record<PiiEntityType, string> = {
  name: 'EMPLOYEE',
  phone: 'PHONE',
  email: 'EMAIL',
  address: 'ADDRESS',
};

/**
 * Непрозрачный тип: сконструировать значение этого типа можно только через
 * maskPII(). Функция вызова внешней модели, объявленная как принимающая
 * только MaskedPayload, физически не скомпилируется при попытке передать
 * ей сырую строку — маскирование становится архитектурным требованием,
 * а не соглашением по коду ревью.
 */
export interface MaskedPayload {
  readonly text: string;
  readonly __brand: 'MaskedPayload';
}

export interface UnmaskMap {
  [token: string]: string;
}

export interface MaskResult {
  masked: MaskedPayload;
  unmaskMap: UnmaskMap;
}

// Достаточно надёжные регулярки для формы значения, не для семантики —
// как и телефон/email в целом: ложные срабатывания безопаснее пропусков.
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[a-zA-Z]{2,})+/g;
// Казахстанские/российские номера: +7/8, опциональные разделители.
const PHONE_RE = /(?:\+7|8)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-()]*\d{2}[\s\-()]*\d{2}/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function maskPII(text: string, knownEntities: readonly PiiEntity[] = []): MaskResult {
  const unmaskMap: UnmaskMap = {};
  const counters: Record<PiiEntityType, number> = { name: 0, phone: 0, email: 0, address: 0 };
  let masked = text;

  const tokenFor = (type: PiiEntityType, value: string): string => {
    counters[type] += 1;
    const token = `${TOKEN_PREFIX[type]}_${counters[type]}`;
    unmaskMap[token] = value;
    return token;
  };

  // 1. Известные структурированные значения — самый надёжный источник,
  //    заменяются первыми, чтобы регулярки ниже не задели уже
  //    замаскированный текст.
  for (const entity of knownEntities) {
    if (!entity.value.trim()) continue;
    const pattern = new RegExp(escapeRegExp(entity.value), 'gi');
    if (pattern.test(masked)) {
      const token = tokenFor(entity.type, entity.value);
      masked = masked.replace(pattern, token);
    }
  }

  // 2. Email и телефон в свободном тексте — форма достаточно устойчива
  //    для регулярки без ложных срабатываний на кириллице/адресах.
  masked = masked.replace(EMAIL_RE, (match) => tokenFor('email', match));
  masked = masked.replace(PHONE_RE, (match) => tokenFor('phone', match));

  return {
    masked: { text: masked, __brand: 'MaskedPayload' },
    unmaskMap,
  };
}

/** Обратная подстановка после ответа внешней модели — agents.md §11.2. */
export function unmaskPII(text: string, unmaskMap: UnmaskMap): string {
  let result = text;
  for (const [token, value] of Object.entries(unmaskMap)) {
    result = result.replaceAll(token, value);
  }
  return result;
}
