import { type AliasEntry, normalizeText, resolveAlias } from '@qajet/engine/intake';
import { CATEGORY_LABEL, type CatalogCategory } from './catalog';

/**
 * Подсказки из накопленных правок консьержа — qajet-master-spec.md §8A:
 * «алиас с hits ≥ 3 начинает применяться».
 *
 * Алиасы пишутся при каждой правке классификации (item-actions.ts) и раньше
 * читались только мёртвым кодом, так что обучение не замыкалось. Здесь алиас
 * применяется как подсказка в превью разбора текста: «такую фразу уже не раз
 * относили к категории X». Это подсказка, а не подстановка: алиас хранит
 * категорию, а не конкретную позицию каталога, и от неё зависит подбор
 * поставщиков, поэтому решение остаётся за человеком.
 */

export interface CategoryHint {
  category: CatalogCategory;
  label: string;
}

export function categoryHintsFor(
  items: readonly { sourceText: string; category: string | null }[],
  aliases: readonly AliasEntry[],
): (CategoryHint | null)[] {
  return items.map((item) => {
    const canonical = resolveAlias(normalizeText(item.sourceText), aliases, 'category');
    if (!canonical || !(canonical in CATEGORY_LABEL)) return null;
    if (canonical === item.category) return null;
    const category = canonical as CatalogCategory;
    return { category, label: CATEGORY_LABEL[category] };
  });
}
