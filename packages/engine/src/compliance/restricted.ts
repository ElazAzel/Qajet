/**
 * Жёсткий фильтр категорий на приёме заявки — agents.md §11.5: «алкоголь,
 * лекарства, оружие, драгметаллы, финансовые продукты и подобное. Это
 * техническая проверка в валидаторе формы, а не подсказка в UX».
 *
 * До этого модуля правило существовало только строкой в спецификации:
 * грепом по всему репозиторию находилась ровно она, кода не было.
 *
 * Проверка намеренно грубая и по ключевым словам, а не «умная»: задача —
 * не пропустить очевидно регулируемую закупку в поток, где её никто не
 * лицензировал (§17: «не запускать регулируемые категории без отдельной
 * проверки лицензирования»). Ложное срабатывание стоит одного разговора с
 * концьержем, пропуск — юридического риска, поэтому порог смещён в
 * сторону запрета. Решение по спорному случаю принимает человек: QAJET
 * заводит такую заявку вручную, а не автоматически.
 */

export type RestrictedCategoryKey =
  | 'alcohol'
  | 'medicine'
  | 'weapons'
  | 'precious_metals'
  | 'financial'
  | 'tobacco';

export interface RestrictedCategory {
  key: RestrictedCategoryKey;
  /** Человеческое название для сообщения об отказе. */
  label: string;
  /** Корни слов: сравниваются как «слово начинается с», см. buildPattern. */
  stems: readonly string[];
}

export const RESTRICTED_CATEGORIES: readonly RestrictedCategory[] = [
  {
    key: 'alcohol',
    label: 'алкоголь',
    stems: [
      'алкогол',
      'спиртн',
      'водк',
      'коньяк',
      'виски',
      'шампанск',
      'вино',
      'вина',
      'пиво',
      'пива',
    ],
  },
  {
    key: 'medicine',
    label: 'лекарства и медицинские изделия',
    stems: ['лекарств', 'медикамент', 'препарат', 'аптечн', 'вакцин', 'антибиотик', 'рецептурн'],
  },
  {
    key: 'weapons',
    label: 'оружие и боеприпасы',
    stems: ['оружи', 'огнестрельн', 'боеприпас', 'патрон', 'взрывчат', 'пистолет', 'винтовк'],
  },
  {
    key: 'precious_metals',
    label: 'драгоценные металлы и камни',
    stems: ['драгметал', 'драгоценн', 'золот', 'серебрян', 'платин', 'бриллиант', 'ювелирн'],
  },
  {
    key: 'financial',
    label: 'финансовые продукты',
    stems: ['страхов', 'кредит', 'займ', 'микрозайм', 'ценн', 'облигац', 'криптовалют', 'токен'],
  },
  {
    key: 'tobacco',
    label: 'табак и никотиносодержащая продукция',
    stems: ['табак', 'сигарет', 'вейп', 'никотин', 'кальян'],
  },
];

/**
 * Кириллица не входит в `\w`, поэтому `\b` вокруг русских слов в JS не
 * срабатывает вовсе — тот же капкан уже был пойман в intake-разборе.
 * Явные lookaround: слово должно НАЧИНАТЬСЯ с корня, но не быть его
 * продолжением слева («вино» ловится, «пианино» — нет).
 */
function buildPattern(stem: string): RegExp {
  return new RegExp(`(?<![a-zа-яё])${stem}`, 'i');
}

const PATTERNS: readonly (RestrictedCategory & { regexes: RegExp[] })[] = RESTRICTED_CATEGORIES.map(
  (category) => ({ ...category, regexes: category.stems.map(buildPattern) }),
);

export interface RestrictedMatch {
  key: RestrictedCategoryKey;
  label: string;
  /** Корень, который сработал — чтобы человек понял, на что именно ответил фильтр. */
  stem: string;
}

/**
 * Первое совпадение или null. Возвращается именно первое, а не все:
 * сообщение об отказе должно называть одну понятную причину, а перечень
 * всех сработавших корней в интерфейсе выглядит как отладочный вывод.
 */
export function findRestrictedCategory(
  ...texts: (string | null | undefined)[]
): RestrictedMatch | null {
  const haystack = texts.filter(Boolean).join(' ');
  if (!haystack) return null;
  for (const category of PATTERNS) {
    for (let i = 0; i < category.regexes.length; i++) {
      const regex = category.regexes[i];
      const stem = category.stems[i];
      if (regex && stem && regex.test(haystack)) {
        return { key: category.key, label: category.label, stem };
      }
    }
  }
  return null;
}

/** Текст отказа — один и тот же и в форме покупателя, и в интейке концьержа. */
export function restrictedCategoryMessage(match: RestrictedMatch): string {
  return `QAJET не закупает эту категорию: ${match.label}. Такие закупки требуют отдельного лицензирования — заведите заявку через менеджера.`;
}
