/**
 * Справочник номенклатуры для пикера позиций в мастере заявки — та же
 * дюжина позиций, что в `packages/db/src/seed/catalog.ts` (источник для
 * сида и живой демо-истории). Скопировано, а не импортировано напрямую:
 * apps/web не тянет `@qajet/db` целиком (drizzle-orm, postgres) ради
 * одной константы без зависимостей от схемы. Если каталог в сиде
 * поменяется — эту копию нужно поправить отдельно, это осознанный
 * компромисс, а не забытая синхронизация.
 *
 * requiredCapabilities и category здесь — не свободный текст: именно по
 * ним `sendRfq` (apps/web/app/lib/actions/order-actions.ts) подбирает
 * поставщиков (совпадение с `supplier_profiles.categories`/`capabilities`),
 * а baseUnitPriceKzt — стартовая ставка для `engine/estimate` (agents.md
 * §8B), пока по товару не накопилось `price_observations`.
 */

export type CatalogCategory = 'merch' | 'corporate-gifts' | 'printing';

export interface CatalogItem {
  itemKey: string;
  category: CatalogCategory;
  name: string;
  unit: string;
  qtyMin: number;
  qtyMax: number;
  requiredCapabilities: string[];
  baseUnitPriceKzt: number;
}

export const CATALOG: readonly [CatalogItem, ...CatalogItem[]] = [
  {
    itemKey: 'tshirt-logo',
    category: 'merch',
    name: 'Футболка с логотипом',
    unit: 'шт',
    qtyMin: 50,
    qtyMax: 500,
    requiredCapabilities: ['screen-print'],
    baseUnitPriceKzt: 3000,
  },
  {
    itemKey: 'hoodie-embroidery',
    category: 'merch',
    name: 'Худи с вышивкой логотипа',
    unit: 'шт',
    qtyMin: 20,
    qtyMax: 150,
    requiredCapabilities: ['embroidery'],
    baseUnitPriceKzt: 9500,
  },
  {
    itemKey: 'cap-logo',
    category: 'merch',
    name: 'Кепка с логотипом',
    unit: 'шт',
    qtyMin: 50,
    qtyMax: 300,
    requiredCapabilities: ['screen-print'],
    baseUnitPriceKzt: 2400,
  },
  {
    itemKey: 'tote-bag',
    category: 'merch',
    name: 'Эко-сумка с принтом',
    unit: 'шт',
    qtyMin: 100,
    qtyMax: 1000,
    requiredCapabilities: ['dtf-print'],
    baseUnitPriceKzt: 1400,
  },
  {
    itemKey: 'newyear-set',
    category: 'corporate-gifts',
    name: 'Новогодний корпоративный набор',
    unit: 'набор',
    qtyMin: 30,
    qtyMax: 200,
    requiredCapabilities: ['gift-assembly', 'branded-packaging'],
    baseUnitPriceKzt: 12_000,
  },
  {
    itemKey: 'welcome-kit',
    category: 'corporate-gifts',
    name: 'Welcome-набор для новых сотрудников',
    unit: 'набор',
    qtyMin: 20,
    qtyMax: 150,
    requiredCapabilities: ['gift-assembly'],
    baseUnitPriceKzt: 8_000,
  },
  {
    itemKey: 'exec-gift',
    category: 'corporate-gifts',
    name: 'Подарок руководителю с гравировкой',
    unit: 'шт',
    qtyMin: 5,
    qtyMax: 30,
    requiredCapabilities: ['engraving'],
    baseUnitPriceKzt: 22_000,
  },
  {
    itemKey: 'booklet-a5',
    category: 'printing',
    name: 'Буклет А5',
    unit: 'шт',
    qtyMin: 200,
    qtyMax: 3000,
    requiredCapabilities: ['offset-print'],
    baseUnitPriceKzt: 380,
  },
  {
    itemKey: 'business-cards',
    category: 'printing',
    name: 'Визитки',
    unit: 'шт',
    qtyMin: 200,
    qtyMax: 2000,
    requiredCapabilities: ['digital-print'],
    baseUnitPriceKzt: 220,
  },
  {
    itemKey: 'banner-2x1',
    category: 'printing',
    name: 'Баннер 2×1 м',
    unit: 'шт',
    qtyMin: 1,
    qtyMax: 20,
    requiredCapabilities: ['large-format-print'],
    baseUnitPriceKzt: 9_000,
  },
  {
    itemKey: 'catalog-bound',
    category: 'printing',
    name: 'Каталог продукции с переплётом',
    unit: 'шт',
    qtyMin: 100,
    qtyMax: 1000,
    requiredCapabilities: ['offset-print', 'binding'],
    baseUnitPriceKzt: 950,
  },
];

export const CATALOG_BY_KEY: ReadonlyMap<string, CatalogItem> = new Map(
  CATALOG.map((item) => [item.itemKey, item]),
);

export const CATEGORY_LABEL: Record<CatalogCategory, string> = {
  merch: 'Мерч',
  'corporate-gifts': 'Корпоративные наборы',
  printing: 'Полиграфия',
};
