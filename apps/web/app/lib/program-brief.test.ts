import { CATALOG_BY_KEY } from '@qajet/engine/catalog';
import { describe, expect, it } from 'vitest';
import {
  buildProgramBriefText,
  getProgramItems,
  PROGRAMS,
  parseProgramBrief,
  programBriefQuery,
  programRequestUrl,
} from './program-brief';

const today = '2026-11-09';
const input = 'program=welcome&qty=50&city=almaty&budget=500000&date=2026-12-01';
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Expected a valid fixture');
  return value;
}

describe('публичный бриф закупки', () => {
  it('сохраняет состав, бюджет и дату без повторного ввода', () => {
    const brief = required(parseProgramBrief(input, today));
    expect(brief).toEqual({
      program: 'welcome',
      qty: 50,
      city: 'almaty',
      budgetKzt: 500000,
      deadlineDate: '2026-12-01',
    });
    expect(programBriefQuery(brief)).toBe(input);
    expect(programRequestUrl()).toBe('/buyer/requests/new?prepared=program');
    expect(programRequestUrl()).not.toContain('500000');
    expect(getProgramItems(brief)).toEqual([{ itemKey: 'welcome-kit', qty: 50 }]);
  });

  it('не добавляет выдуманные цены, сроки исполнения и поставщиков в бриф', () => {
    const brief = required(parseProgramBrief(input, today));
    const message = buildProgramBriefText(brief);
    expect(message).toContain('500 000');
    expect(message).toContain('10 000');
    expect(message).toContain('2026-12-01');
    expect(message).toContain('Welcome-набор');
    expect(message).not.toMatch(/стоимость заказа|доставим за|23%|23 %/i);
  });

  it.each(PROGRAMS)('использует действующий каталог и его пределы: $id', (program) => {
    for (const qty of [program.qtyMin, program.qtyMax]) {
      const brief = required(
        parseProgramBrief(`program=${program.id}&qty=${qty}&city=astana`, today),
      );
      expect(brief).not.toBeNull();
      for (const line of getProgramItems(brief)) {
        const item = required(CATALOG_BY_KEY.get(line.itemKey));
        expect(item).toBeDefined();
        expect(line.qty).toBeGreaterThanOrEqual(item.qtyMin);
        expect(line.qty).toBeLessThanOrEqual(item.qtyMax);
      }
    }
  });

  it('сохраняет одну фиксированную позицию баннера при изменении числа участников', () => {
    const brief = required(parseProgramBrief('program=event&qty=200&city=almaty', today));
    expect(getProgramItems(brief)).toContainEqual({ itemKey: 'banner-2x1', qty: 1 });
    expect(getProgramItems(brief)).toContainEqual({ itemKey: 'tshirt-logo', qty: 200 });
  });

  it.each([
    null,
    '',
    '//evil.example',
    'program=__proto__&qty=50&city=almaty',
    'program=welcome&qty=19&city=almaty',
    'program=welcome&qty=151&city=almaty',
    'program=event&qty=50.5&city=almaty',
    'program=event&qty=1e2&city=almaty',
    'program=event&qty=100&qty=200&city=almaty',
    'program=welcome&qty=50&city=tashkent',
    `${input}&budget=-1`,
    `${input}&next=https://evil.example`,
    'program=welcome&qty=50&city=almaty&budget=Infinity',
    'program=welcome&qty=50&city=almaty&budget=0',
    'program=welcome&qty=50&city=almaty&budget=1000000000000',
    'program=welcome&qty=50&city=almaty&date=2026-02-31',
    'program=welcome&qty=50&city=almaty&date=2026-11-08',
    'program=welcome&qty=50&city=almaty&supplier=someone',
    'x'.repeat(1025),
  ])('отклоняет неверный или расширенный извне бриф: %s', (value) => {
    expect(parseProgramBrief(value, today)).toBeNull();
  });

  it('не подменяет неуказанные дату и бюджет предположениями', () => {
    expect(parseProgramBrief('program=welcome&qty=20&city=almaty', today)).toEqual({
      program: 'welcome',
      qty: 20,
      city: 'almaty',
      budgetKzt: null,
      deadlineDate: null,
    });
  });
});
