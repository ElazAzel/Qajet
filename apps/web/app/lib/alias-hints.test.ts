import type { AliasEntry } from '@qajet/engine/intake';
import { describe, expect, it } from 'vitest';
import { categoryHintsFor } from './alias-hints';

const alias = (a: string, canonical: string, hits: number, kind = 'category'): AliasEntry => ({
  alias: a,
  canonical,
  kind,
  hits,
});

describe('categoryHintsFor', () => {
  const items = [
    { sourceText: '100 кружек с логотипом', category: 'merch' },
    { sourceText: '50 блокнотов', category: 'corporate-gifts' },
  ];

  it('подсказывает категорию только для алиаса с тремя и более подтверждениями', () => {
    const hints = categoryHintsFor(items, [
      alias('100 кружек с логотипом', 'printing', 3),
      alias('50 блокнотов', 'merch', 2),
    ]);
    expect(hints[0]).toEqual({ category: 'printing', label: expect.any(String) });
    expect(hints[1]).toBeNull();
  });

  it('не подсказывает, если категория уже совпала или неизвестна каталогу', () => {
    expect(categoryHintsFor(items, [alias('100 кружек с логотипом', 'merch', 5)])[0]).toBeNull();
    expect(categoryHintsFor(items, [alias('100 кружек с логотипом', 'weapons', 9)])[0]).toBeNull();
  });

  it('игнорирует алиасы других видов и сравнивает нормализованный текст', () => {
    expect(
      categoryHintsFor(items, [alias('100 кружек с логотипом', 'printing', 9, 'unit')])[0],
    ).toBeNull();
    const mixed = categoryHintsFor(
      [{ sourceText: '100 КРУЖЕК  с логотипом', category: 'merch' }],
      [alias('100 кружек с логотипом', 'printing', 3)],
    );
    expect(mixed[0]?.category).toBe('printing');
  });
});
