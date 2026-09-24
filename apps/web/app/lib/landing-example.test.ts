import { parseRequestText } from '@qajet/engine/intake';
import { describe, expect, it } from 'vitest';
import { CATALOG } from './catalog';
import { LANDING_EXAMPLE_PHRASE } from './landing-example';

/**
 * Посадочная обещает: «напишите одной фразой». До 2026-09-24 там стоял пример,
 * который сам продукт не разбирал («позиция не распознана», количество вне
 * допустимого для набора). Тест держит обещание и продукт вместе.
 */
describe('пример с посадочной разбирается формой заявки', () => {
  const draft = parseRequestText(
    LANDING_EXAMPLE_PHRASE,
    CATALOG.map((item) => ({
      key: item.itemKey,
      label: item.name,
      category: item.category,
      unit: item.unit,
      qtyMin: item.qtyMin,
      qtyMax: item.qtyMax,
      requiredCapabilities: item.requiredCapabilities,
    })),
    new Date('2026-09-24T09:00:00Z'),
  );

  it('находит позицию каталога и количество без уточнений', () => {
    expect(draft.items).toHaveLength(1);
    const [item] = draft.items;
    expect(item?.itemLabel).toBe('Welcome-набор для новых сотрудников');
    expect(item?.needsClarification, item?.clarificationReason ?? '').toBe(false);
  });

  it('понимает срок и бюджет', () => {
    expect(draft.deadline.value).toBe('2026-10-20');
    expect(draft.budget.value).toBe(3_000_000);
  });
});
