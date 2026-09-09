/**
 * Intake — разбор свободного текста заявки в спецификацию, agents.md §8A.
 *
 * Словари категорий/материалов/техпроцессов с алиасами живут в
 * `extraction_aliases` (БД, сид Фазы 3) и передаются вызывающим кодом —
 * intake остаётся чистой функцией без обращения к сети или базе.
 */

export interface ParsedField<T> {
  value: T | null;
  confidence: number;
  needsClarification: boolean;
  reason?: string;
}

const CONFIDENCE_THRESHOLD = 0.72;

function clarify<T>(reason: string): ParsedField<T> {
  return { value: null, confidence: 0, needsClarification: true, reason };
}

// ---------------------------------------------------------------------------
// Нормализация текста
// ---------------------------------------------------------------------------

/**
 * JCUKEN-раскладка: символы, набранные латиницей при включённой кириллической
 * раскладке (частая ошибка при копировании из мессенджера на телефоне).
 * Ключ — латинская буква на клавише, значение — кириллическая на той же
 * физической клавише в раскладке ЙЦУКЕН.
 */
const LATIN_TO_JCUKEN: Record<string, string> = {
  q: 'й',
  w: 'ц',
  e: 'у',
  r: 'к',
  t: 'е',
  y: 'н',
  u: 'г',
  i: 'ш',
  o: 'щ',
  p: 'з',
  '[': 'х',
  ']': 'ъ',
  a: 'ф',
  s: 'ы',
  d: 'в',
  f: 'а',
  g: 'п',
  h: 'р',
  j: 'о',
  k: 'л',
  l: 'д',
  ';': 'ж',
  "'": 'э',
  z: 'я',
  x: 'ч',
  c: 'с',
  v: 'м',
  b: 'и',
  n: 'т',
  m: 'ь',
  ',': 'б',
  '.': 'ю',
};

/**
 * Нормализация: регистр, ё→е, схлопывание пробелов. Раскладку (латиница ↔
 * ЙЦУКЕН) сюда сознательно НЕ включаем: доля латинских букв в тексте не
 * отличает реальную мисраскладку от настоящего английского слова (артикул,
 * бренд) — у обоих она под 100%. Без словаря частот это неразличимо, а
 * фальшивая уверенность хуже отсутствия функции (agents.md §17). Поэтому
 * `convertJcukenLayout` — отдельное, явное действие: пользователь или
 * консьерж вызывает его сам, когда видит, что раскладка действительно
 * съехала, ровно как «исправить раскладку» в обычных ОС.
 */
export function normalizeText(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  const lower = trimmed.toLowerCase();
  return lower.replace(/ё/g, 'е');
}

/** Явный, не автоматический перевод латиницы в ЙЦУКЕН по физическим клавишам. */
export function convertJcukenLayout(text: string): string {
  let converted = '';
  for (const ch of text) {
    converted += LATIN_TO_JCUKEN[ch] ?? ch;
  }
  return converted;
}

// ---------------------------------------------------------------------------
// Количество
// ---------------------------------------------------------------------------

export interface QuantityMatch {
  qty: number;
  unit: string | null;
}

const QUANTITY_RE =
  /(\d[\d\s]*)\s*(шт\.?|штук|коробок|уп\.?|упаковок|компл\.?|комплектов|пар|наборов)?/i;

/** Количества: `200 шт`, `200шт`, `2 000 штук`, голое число как тираж. */
export function extractQuantity(text: string): ParsedField<QuantityMatch> {
  const match = QUANTITY_RE.exec(text);
  if (!match) return clarify('Не удалось найти количество в тексте заявки');
  const rawNumber = match[1];
  if (!rawNumber) return clarify('Не удалось найти количество в тексте заявки');
  const qty = Number.parseInt(rawNumber.replace(/\s/g, ''), 10);
  if (!Number.isFinite(qty) || qty <= 0) {
    return clarify('Найденное количество не является положительным числом');
  }
  const unit = match[2]?.replace(/\.$/, '') ?? null;
  // Без единицы измерения рядом с числом — это может быть что угодно
  // (номер телефона, артикул), уверенность ниже порога.
  const confidence = unit ? 0.95 : 0.6;
  return {
    value: { qty, unit },
    confidence,
    needsClarification: confidence < CONFIDENCE_THRESHOLD,
  };
}

// ---------------------------------------------------------------------------
// Бюджет
// ---------------------------------------------------------------------------

const BUDGET_MILLIONS_RE = /(\d+(?:[.,]\d+)?)\s*млн/i;
const BUDGET_PLAIN_RE = /(\d[\d\s]*)\s*(?:тг|тенге|₸)/i;

/** Бюджет: `до 1,2 млн`, `1 200 000 тг`. */
export function extractBudget(text: string): ParsedField<number> {
  const millions = BUDGET_MILLIONS_RE.exec(text);
  if (millions?.[1]) {
    const value = Number.parseFloat(millions[1].replace(',', '.')) * 1_000_000;
    return { value, confidence: 0.9, needsClarification: false };
  }
  const plain = BUDGET_PLAIN_RE.exec(text);
  if (plain?.[1]) {
    const value = Number.parseInt(plain[1].replace(/\s/g, ''), 10);
    if (Number.isFinite(value) && value > 0) {
      return { value, confidence: 0.9, needsClarification: false };
    }
  }
  return clarify('Бюджет не упомянут в тексте заявки');
}

// ---------------------------------------------------------------------------
// Срок
// ---------------------------------------------------------------------------

const MONTHS_GENITIVE: Record<string, number> = {
  января: 0,
  февраля: 1,
  марта: 2,
  апреля: 3,
  мая: 4,
  июня: 5,
  июля: 6,
  августа: 7,
  сентября: 8,
  октября: 9,
  ноября: 10,
  декабря: 11,
};

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Срок: `к 15 октября`, `до 15.10`, `через 3 недели`. */
export function extractDeadline(text: string, referenceDate: Date): ParsedField<string> {
  const relativeMatch = /через\s+(\d+)\s*(день|дня|дней|недел[юия]|месяц[аеы]?)/i.exec(text);
  if (relativeMatch?.[1] && relativeMatch[2]) {
    const amount = Number.parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2].toLowerCase();
    const days = unit.startsWith('недел')
      ? amount * 7
      : unit.startsWith('месяц')
        ? amount * 30
        : amount;
    const result = new Date(referenceDate.getTime() + days * 24 * 60 * 60 * 1000);
    return { value: toIsoDate(result), confidence: 0.85, needsClarification: false };
  }

  const monthNameMatch = /(?:к|до)\s+(\d{1,2})\s+([а-я]+)/i.exec(text);
  if (monthNameMatch?.[1] && monthNameMatch[2]) {
    const day = Number.parseInt(monthNameMatch[1], 10);
    const month = MONTHS_GENITIVE[monthNameMatch[2].toLowerCase()];
    if (month !== undefined && day >= 1 && day <= 31) {
      const year = referenceDate.getFullYear();
      let result = new Date(Date.UTC(year, month, day));
      if (result.getTime() < referenceDate.getTime()) {
        result = new Date(Date.UTC(year + 1, month, day));
      }
      return { value: toIsoDate(result), confidence: 0.85, needsClarification: false };
    }
  }

  const numericMatch = /(?:к|до)\s+(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/.exec(text);
  if (numericMatch?.[1] && numericMatch[2]) {
    const day = Number.parseInt(numericMatch[1], 10);
    const month = Number.parseInt(numericMatch[2], 10) - 1;
    const yearRaw = numericMatch[3];
    let year = yearRaw ? Number.parseInt(yearRaw, 10) : referenceDate.getFullYear();
    if (yearRaw && year < 100) year += 2000;
    if (day < 1 || day > 31 || month < 0 || month > 11) {
      return clarify('Дата в тексте заявки не распознана');
    }
    let result = new Date(Date.UTC(year, month, day));
    if (!yearRaw && result.getTime() < referenceDate.getTime()) {
      result = new Date(Date.UTC(year + 1, month, day));
    }
    return { value: toIsoDate(result), confidence: 0.85, needsClarification: false };
  }

  return clarify('Срок не упомянут в тексте заявки');
}

// ---------------------------------------------------------------------------
// Нечёткое сопоставление номенклатуры — триграммы + Дамерау—Левенштейн
// ---------------------------------------------------------------------------

function damerauLevenshteinDistance(a: string, b: string): number {
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;

  const d: number[][] = Array.from({ length: al + 1 }, () => new Array<number>(bl + 1).fill(0));
  for (let i = 0; i <= al; i++) {
    const row = d[i];
    if (row) row[0] = i;
  }
  const firstRow = d[0];
  if (firstRow) {
    for (let j = 0; j <= bl; j++) firstRow[j] = j;
  }

  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const row = d[i];
      const prevRow = d[i - 1];
      if (!row || !prevRow) continue;
      const deletion = prevRow[j] ?? Number.POSITIVE_INFINITY;
      const insertion = row[j - 1] ?? Number.POSITIVE_INFINITY;
      const substitution = prevRow[j - 1] ?? Number.POSITIVE_INFINITY;
      let best = Math.min(deletion + 1, insertion + 1, substitution + cost);

      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        const prevPrevRow = d[i - 2];
        const transposition = prevPrevRow?.[j - 2] ?? Number.POSITIVE_INFINITY;
        best = Math.min(best, transposition + cost);
      }
      row[j] = best;
    }
  }
  return d[al]?.[bl] ?? Math.max(al, bl);
}

function trigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const grams = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) {
    grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

/** Коэффициент Дайса по множествам триграмм — устойчив к перестановке слов. */
function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  let intersection = 0;
  for (const g of ta) if (tb.has(g)) intersection++;
  return (2 * intersection) / (ta.size + tb.size);
}

function levenshteinSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length, 1);
  return 1 - damerauLevenshteinDistance(a, b) / maxLen;
}

/** Комбинированная схожесть: среднее триграмм и нормализованного Дамерау—Левенштейна. */
export function stringSimilarity(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  return (trigramSimilarity(na, nb) + levenshteinSimilarity(na, nb)) / 2;
}

export interface CatalogEntry {
  key: string;
  label: string;
}

/**
 * Ищет ближайшую по написанию позицию каталога номенклатуры. Порог 0.72 —
 * agents.md §8A: ниже порога результат не подставляется молча, а уходит в
 * `needs_clarification` с человеческой причиной.
 */
export function matchNomenclature(
  term: string,
  catalog: readonly CatalogEntry[],
): ParsedField<string> {
  if (catalog.length === 0) return clarify('Каталог номенклатуры пуст');

  let bestKey: string | null = null;
  let bestScore = -1;
  for (const entry of catalog) {
    const score = stringSimilarity(term, entry.label);
    if (score > bestScore) {
      bestScore = score;
      bestKey = entry.key;
    }
  }

  if (bestKey === null || bestScore < CONFIDENCE_THRESHOLD) {
    return {
      value: bestKey,
      confidence: Math.max(0, bestScore),
      needsClarification: true,
      reason: `Не удалось уверенно сопоставить «${term}» с каталогом (лучшее совпадение: ${Math.round(Math.max(0, bestScore) * 100)}%)`,
    };
  }

  return { value: bestKey, confidence: bestScore, needsClarification: false };
}

// ---------------------------------------------------------------------------
// Алиасы — обучение на правках консьержа (extraction_aliases, agents.md §8A)
// ---------------------------------------------------------------------------

export interface AliasEntry {
  alias: string;
  canonical: string;
  kind: string;
  hits: number;
}

/** agents.md §8A: «hits ≥ 3 начинает применяться автоматически». */
export const ALIAS_AUTO_APPLY_HITS_THRESHOLD = 3;

/**
 * Ищет подтверждённый алиас для НОРМАЛИЗОВАННОГО текста (см. `normalizeText`)
 * — словарь передаётся вызывающим кодом, ровно как каталог в
 * `matchNomenclature`, intake не обращается к базе сам. Ниже порога
 * `hits` — сигнал ещё не устойчивый, не возвращаем совпадение (agents.md
 * §8A: не подставлять молча то, что не накопило подтверждений).
 */
export function resolveAlias(
  normalizedText: string,
  aliases: readonly AliasEntry[],
  kind: string,
): string | null {
  const match = aliases.find(
    (a) =>
      a.kind === kind && a.hits >= ALIAS_AUTO_APPLY_HITS_THRESHOLD && a.alias === normalizedText,
  );
  return match?.canonical ?? null;
}
