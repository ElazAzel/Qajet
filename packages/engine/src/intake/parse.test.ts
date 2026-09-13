import { describe, expect, it } from 'vitest';
import {
  type AliasEntry,
  convertJcukenLayout,
  extractBudget,
  extractDeadline,
  extractQuantity,
  matchNomenclature,
  normalizeText,
  parseRequestText,
  resolveAlias,
  stringSimilarity,
} from './parse.js';

describe('normalizeText', () => {
  it('приводит к нижнему регистру и убирает ё', () => {
    expect(normalizeText('Ёлочные Игрушки')).toBe('елочные игрушки');
  });

  it('схлопывает лишние пробелы', () => {
    expect(normalizeText('  кружки   с логотипом  ')).toBe('кружки с логотипом');
  });

  it('не трогает раскладку автоматически — латинский текст остаётся латинским', () => {
    // Автоопределение по доле латинских букв неразличимо от настоящего
    // английского текста (артикулы, бренды) — поэтому нормализация раскладку
    // не трогает вовсе, см. convertJcukenLayout ниже.
    expect(normalizeText('Model X200 Pro')).toBe('model x200 pro');
  });
});

describe('convertJcukenLayout', () => {
  it('переводит текст, набранный латиницей по ошибке (JCUKEN), в кириллицу — по явному вызову', () => {
    // "заказ" в раскладке ЙЦУКЕН физически набирается как "pfrfp" на латинице.
    expect(convertJcukenLayout('pfrfp')).toBe('заказ');
  });
});

describe('extractQuantity', () => {
  it('распознаёт "200 шт"', () => {
    const result = extractQuantity('Нужны кружки, 200 шт, к следующей неделе');
    expect(result.value).toEqual({ qty: 200, unit: 'шт' });
    expect(result.needsClarification).toBe(false);
  });

  it('распознаёт "200шт" без пробела', () => {
    const result = extractQuantity('200шт кружек');
    expect(result.value).toEqual({ qty: 200, unit: 'шт' });
  });

  it('распознаёт "2 000 штук" с пробелом-разделителем тысяч', () => {
    const result = extractQuantity('тираж 2 000 штук');
    expect(result.value?.qty).toBe(2000);
  });

  it('без единицы измерения уверенность ниже порога 0.72', () => {
    const result = extractQuantity('нужно 50 для мероприятия');
    expect(result.value?.qty).toBe(50);
    expect(result.confidence).toBeLessThan(0.72);
    expect(result.needsClarification).toBe(true);
  });

  it('без числа в тексте — needs_clarification с причиной', () => {
    const result = extractQuantity('нужны кружки с логотипом');
    expect(result.value).toBeNull();
    expect(result.needsClarification).toBe(true);
    expect(result.reason).toBeTruthy();
  });
});

describe('extractBudget', () => {
  it('распознаёт "до 1,2 млн"', () => {
    const result = extractBudget('бюджет до 1,2 млн');
    expect(result.value).toBe(1_200_000);
    expect(result.needsClarification).toBe(false);
  });

  it('распознаёт "1 200 000 тг"', () => {
    const result = extractBudget('готовы заплатить 1 200 000 тг');
    expect(result.value).toBe(1_200_000);
  });

  it('распознаёт символ ₸', () => {
    const result = extractBudget('до 500000 ₸');
    expect(result.value).toBe(500_000);
  });

  it('без упоминания бюджета — needs_clarification', () => {
    const result = extractBudget('нужны кружки к пятнице');
    expect(result.needsClarification).toBe(true);
  });
});

describe('extractDeadline', () => {
  const reference = new Date('2026-09-01T00:00:00Z');

  it('распознаёт "через 3 недели"', () => {
    const result = extractDeadline('нужно через 3 недели', reference);
    expect(result.value).toBe('2026-09-22');
  });

  it('распознаёт "через 5 дней"', () => {
    const result = extractDeadline('нужно через 5 дней', reference);
    expect(result.value).toBe('2026-09-06');
  });

  it('распознаёт "к 15 октября"', () => {
    const result = extractDeadline('нужно к 15 октября', reference);
    expect(result.value).toBe('2026-10-15');
  });

  it('переносит на следующий год, если дата уже прошла в текущем', () => {
    const result = extractDeadline('нужно к 5 января', reference);
    expect(result.value).toBe('2027-01-05');
  });

  it('распознаёт "до 15.10"', () => {
    const result = extractDeadline('нужно до 15.10', reference);
    expect(result.value).toBe('2026-10-15');
  });

  it('без срока — needs_clarification', () => {
    const result = extractDeadline('нужны кружки с логотипом', reference);
    expect(result.needsClarification).toBe(true);
  });
});

describe('stringSimilarity', () => {
  it('идентичные строки — схожесть 1', () => {
    expect(stringSimilarity('кружка', 'кружка')).toBe(1);
  });

  it('опечатка в одну букву — выше случайного совпадения, но не идеальная схожесть', () => {
    const sim = stringSimilarity('кружка', 'крушка');
    expect(sim).toBeGreaterThan(0.5);
    expect(sim).toBeLessThan(1);
  });

  it('совершенно разные строки — низкая схожесть', () => {
    expect(stringSimilarity('кружка', 'экскаватор')).toBeLessThan(0.3);
  });
});

describe('matchNomenclature', () => {
  const catalog = [
    { key: 'mug-ceramic', label: 'кружка керамическая' },
    { key: 'tshirt-cotton', label: 'футболка хлопковая' },
    { key: 'tote-bag', label: 'сумка-шоппер' },
  ];

  it('уверенно сопоставляет опечатку с правильной позицией каталога', () => {
    const result = matchNomenclature('кружка керамич', catalog);
    expect(result.value).toBe('mug-ceramic');
    expect(result.needsClarification).toBe(false);
  });

  it('ниже порога 0.72 — needs_clarification, а не молчаливое угадывание', () => {
    const result = matchNomenclature('садовая тачка', catalog);
    expect(result.needsClarification).toBe(true);
    expect(result.reason).toBeTruthy();
  });

  it('пустой каталог — needs_clarification без падения', () => {
    const result = matchNomenclature('кружка', []);
    expect(result.needsClarification).toBe(true);
    expect(result.value).toBeNull();
  });
});

describe('resolveAlias', () => {
  const aliases: AliasEntry[] = [
    { alias: 'футболки поло', canonical: 'printing', kind: 'category', hits: 4 },
    { alias: 'редкая фраза', canonical: 'merch', kind: 'category', hits: 1 },
  ];

  it('отдаёт canonical для алиаса с hits ≥ 3', () => {
    expect(resolveAlias('футболки поло', aliases, 'category')).toBe('printing');
  });

  it('ниже порога hits — не подставляет', () => {
    expect(resolveAlias('редкая фраза', aliases, 'category')).toBeNull();
  });

  it('нет совпадения по тексту — null', () => {
    expect(resolveAlias('что-то ещё', aliases, 'category')).toBeNull();
  });

  it('совпадение есть, но другой kind — null', () => {
    expect(resolveAlias('футболки поло', aliases, 'material')).toBeNull();
  });
});

describe('parseRequestText', () => {
  const catalog = [
    {
      key: 'tshirt-logo',
      label: 'футболка с логотипом',
      category: 'merch',
      unit: 'шт',
      qtyMin: 50,
      qtyMax: 500,
      requiredCapabilities: ['screen-print'],
    },
    {
      key: 'mug-logo',
      label: 'кружка с логотипом',
      category: 'merch',
      unit: 'шт',
      qtyMin: 50,
      qtyMax: 1000,
      requiredCapabilities: ['screen-print'],
    },
  ];

  it('разбирает несколько позиций, общие срок и бюджет, не меняя ввод молча', () => {
    const result = parseRequestText(
      '200 футболок с логотипом и 150 кружек с логотипом; бюджет до 1,2 млн; доставка до 15 октября',
      catalog,
      new Date('2026-09-01T00:00:00Z'),
    );

    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => item.itemKey)).toEqual(['tshirt-logo', 'mug-logo']);
    expect(result.items.map((item) => item.quantity.value?.qty)).toEqual([200, 150]);
    expect(result.items.every((item) => !item.needsClarification)).toBe(true);
    expect(result.budget.value).toBe(1_200_000);
    expect(result.deadline.value).toBe('2026-10-15');
    expect(result.needsClarification).toBe(false);
  });

  it('оставляет неуказанное количество и незнакомую позицию уточнением', () => {
    const result = parseRequestText('футболка с логотипом; 20 неизвестных сувениров', catalog);

    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.quantity.value).toBeNull();
    expect(result.items[0]?.needsClarification).toBe(true);
    expect(result.items[1]?.itemKey).toBeNull();
    expect(result.items[1]?.needsClarification).toBe(true);
    expect(result.needsClarification).toBe(true);
  });

  it('не принимает отрицательный бюджет как отсутствие ограничения', () => {
    const result = parseRequestText('-1000 тг на 200 футболок', catalog);

    expect(result.budget.value).toBeNull();
    expect(result.budget.needsClarification).toBe(true);
    expect(result.budget.reason).toContain('положительным');
  });
});
