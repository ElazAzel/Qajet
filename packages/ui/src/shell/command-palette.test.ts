import { describe, expect, it } from 'vitest';
import { groupBy } from './command-palette';

describe('groupBy', () => {
  it('группирует по ключу, сохраняя порядок внутри группы', () => {
    const items = [
      { id: 'a', group: 'Заказы' },
      { id: 'b', group: 'Действия' },
      { id: 'c', group: 'Заказы' },
    ];

    const groups = groupBy(items, (item) => item.group);

    expect(Object.keys(groups)).toEqual(['Заказы', 'Действия']);
    expect(groups.Заказы?.map((i) => i.id)).toEqual(['a', 'c']);
    expect(groups.Действия?.map((i) => i.id)).toEqual(['b']);
  });

  it('пустой список — пустой объект групп', () => {
    expect(groupBy([], () => 'any')).toEqual({});
  });

  it('все элементы в одной группе, если ключ у всех одинаковый', () => {
    const items = [{ v: 1 }, { v: 2 }, { v: 3 }];
    const groups = groupBy(items, () => 'Все');
    expect(groups.Все).toHaveLength(3);
  });
});
