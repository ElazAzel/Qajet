/**
 * Совместимые seed-экспорты единого справочника из @qajet/engine/catalog.
 * Seed не хранит вторую копию номенклатуры: изменения каталога теперь
 * одинаково видны расчётам, web и демо-генератору.
 */
export {
  CATALOG as SEED_CATALOG,
  CATALOG_BY_KEY,
  CATEGORY_LABEL,
  type CatalogCategory,
  type CatalogItem,
  catalogInCategory,
} from '@qajet/engine/catalog';
