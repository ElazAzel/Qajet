import { describe, expect, it } from 'vitest';
import {
  findRestrictedCategory,
  RESTRICTED_CATEGORIES,
  restrictedCategoryMessage,
} from './restricted.js';

describe('жёсткий фильтр категорий (agents.md §11.5)', () => {
  it('ловит регулируемые категории в свободном тексте заявки', () => {
    expect(findRestrictedCategory('Нужен виски в подарочной упаковке для клиентов')?.key).toBe(
      'alcohol',
    );
    expect(findRestrictedCategory('Закупка патронов для тира')?.key).toBe('weapons');
    expect(findRestrictedCategory(null, 'Ювелирные значки с логотипом')?.key).toBe(
      'precious_metals',
    );
    expect(findRestrictedCategory('Корпоративное страхование сотрудников')?.key).toBe('financial');
  });

  it('проверяет все переданные куски текста вместе — название и описание', () => {
    expect(findRestrictedCategory('Новогодние наборы', 'внутри шампанское')?.key).toBe('alcohol');
  });

  it('не срабатывает на обычных закупках', () => {
    for (const text of [
      'Футболки с логотипом, 200 шт',
      'Каталог продукции с переплётом',
      'Эко-сумки с принтом к конференции',
      'Ежедневники и ручки для welcome-набора',
    ]) {
      expect(findRestrictedCategory(text)).toBeNull();
    }
  });

  it('корень ловится только в начале слова — кириллица мимо \\b в JS', () => {
    // «вино» — запрещено, «пианино» содержит те же буквы, но не начинается с корня.
    expect(findRestrictedCategory('Вино к ужину')?.key).toBe('alcohol');
    expect(findRestrictedCategory('Аренда пианино на мероприятие')).toBeNull();
  });

  it('пустой ввод — не срабатывание, а не падение', () => {
    expect(findRestrictedCategory()).toBeNull();
    expect(findRestrictedCategory('', null, undefined)).toBeNull();
  });

  it('сообщение об отказе называет категорию и объясняет, что делать', () => {
    const match = findRestrictedCategory('нужна водка');
    expect(match).not.toBeNull();
    const message = restrictedCategoryMessage(match as NonNullable<typeof match>);
    expect(message).toContain('алкоголь');
    expect(message).toContain('менеджера');
  });

  it('у каждой категории есть непустой набор корней и человеческое название', () => {
    for (const category of RESTRICTED_CATEGORIES) {
      expect(category.stems.length).toBeGreaterThan(0);
      expect(category.label.length).toBeGreaterThan(0);
    }
  });
});
