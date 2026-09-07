/**
 * 15 поставщиков сида — agents.md §13: три категории (мерч, корпоративные
 * наборы, полиграфия), разные техпроцессы, налоговые режимы (минимум 3 на
 * упрощённой декларации, чтобы эффект СНР §11.4 был виден на реальных
 * данных), история исполнения и сроки.
 *
 * `seedKey` — стабильный ключ ТОЛЬКО для связывания сущностей внутри
 * генератора сида; реальный id — uuid, назначенный БД при вставке.
 */

export type SeedTaxMode = 'general' | 'simplified' | 'retail' | 'unknown';
export type SeedCategory = 'merch' | 'corporate-gifts' | 'printing';

export interface SeedSupplier {
  seedKey: string;
  name: string;
  bin: string;
  taxMode: SeedTaxMode;
  vatStatus: 'registered' | 'not_registered' | 'unknown';
  city: string;
  categories: SeedCategory[];
  capabilities: string[];
  minOrderKzt: number | null;
  leadTimeDaysDefault: number;
  /** Личный коэффициент надёжности по сроку — насколько исторически опаздывает/успевает. */
  reliabilityFactor: number;
  /** Базовая ставка за единицу для истории цен этого поставщика (до эффекта тиража). */
  baseUnitPriceKzt: number;
  verified: boolean;
}

export const SEED_SUPPLIERS: readonly SeedSupplier[] = [
  // --- Мерч ---
  {
    seedKey: 'printcraft-kz',
    name: 'PrintCraft KZ',
    bin: '900540000011',
    taxMode: 'general',
    vatStatus: 'registered',
    city: 'Алматы',
    categories: ['merch'],
    capabilities: ['screen-print', 'embroidery'],
    minOrderKzt: 50_000,
    leadTimeDaysDefault: 7,
    reliabilityFactor: 1.0,
    baseUnitPriceKzt: 3200,
    verified: true,
  },
  {
    seedKey: 'merchline-almaty',
    name: 'MerchLine Almaty',
    bin: '900540000022',
    taxMode: 'simplified',
    vatStatus: 'not_registered',
    city: 'Алматы',
    categories: ['merch'],
    capabilities: ['screen-print'],
    minOrderKzt: 30_000,
    leadTimeDaysDefault: 6,
    reliabilityFactor: 1.15,
    baseUnitPriceKzt: 2800,
    verified: true,
  },
  {
    seedKey: 'brandwear-studio',
    name: 'BrandWear Studio',
    bin: '900540000033',
    taxMode: 'general',
    vatStatus: 'registered',
    city: 'Алматы',
    categories: ['merch'],
    capabilities: ['screen-print', 'embroidery', 'dtf-print'],
    minOrderKzt: 100_000,
    leadTimeDaysDefault: 9,
    reliabilityFactor: 0.95,
    baseUnitPriceKzt: 3600,
    verified: true,
  },
  {
    seedKey: 'soft-merch',
    name: 'Софт Мерч',
    bin: '900540000044',
    taxMode: 'simplified',
    vatStatus: 'not_registered',
    city: 'Алматы',
    categories: ['merch'],
    capabilities: ['embroidery'],
    minOrderKzt: 20_000,
    leadTimeDaysDefault: 5,
    reliabilityFactor: 1.05,
    baseUnitPriceKzt: 2600,
    verified: true,
  },
  {
    seedKey: 'atameken-promo',
    name: 'Атамекен Промо',
    bin: '900540000055',
    taxMode: 'unknown',
    vatStatus: 'unknown',
    city: 'Шымкент',
    categories: ['merch'],
    capabilities: ['screen-print'],
    minOrderKzt: 40_000,
    leadTimeDaysDefault: 10,
    reliabilityFactor: 1.3,
    baseUnitPriceKzt: 2400,
    verified: false,
  },

  // --- Корпоративные наборы / подарки ---
  {
    seedKey: 'giftology-almaty',
    name: 'Giftology Almaty',
    bin: '900540000066',
    taxMode: 'general',
    vatStatus: 'registered',
    city: 'Алматы',
    categories: ['corporate-gifts'],
    capabilities: ['gift-assembly', 'branded-packaging'],
    minOrderKzt: 150_000,
    leadTimeDaysDefault: 12,
    reliabilityFactor: 1.0,
    baseUnitPriceKzt: 8500,
    verified: true,
  },
  {
    seedKey: 'prestige-corporate',
    name: 'Prestige Corporate',
    bin: '900540000077',
    taxMode: 'simplified',
    vatStatus: 'not_registered',
    city: 'Алматы',
    categories: ['corporate-gifts'],
    capabilities: ['gift-assembly'],
    minOrderKzt: 80_000,
    leadTimeDaysDefault: 10,
    reliabilityFactor: 1.1,
    baseUnitPriceKzt: 7200,
    verified: true,
  },
  {
    seedKey: 'nauryz-daru',
    name: 'Наурыз Дару',
    bin: '900540000088',
    taxMode: 'simplified',
    vatStatus: 'not_registered',
    city: 'Алматы',
    categories: ['corporate-gifts'],
    capabilities: ['gift-assembly', 'branded-packaging'],
    minOrderKzt: 60_000,
    leadTimeDaysDefault: 8,
    reliabilityFactor: 1.0,
    baseUnitPriceKzt: 6800,
    verified: true,
  },
  {
    seedKey: 'vip-present-kz',
    name: 'VIP Present KZ',
    bin: '900540000099',
    taxMode: 'general',
    vatStatus: 'registered',
    city: 'Астана',
    categories: ['corporate-gifts'],
    capabilities: ['gift-assembly', 'branded-packaging', 'engraving'],
    minOrderKzt: 200_000,
    leadTimeDaysDefault: 14,
    reliabilityFactor: 0.9,
    baseUnitPriceKzt: 11_000,
    verified: true,
  },
  {
    seedKey: 'corporate-style',
    name: 'Corporate Style',
    bin: '900540000100',
    taxMode: 'unknown',
    vatStatus: 'unknown',
    city: 'Алматы',
    categories: ['corporate-gifts'],
    capabilities: ['gift-assembly'],
    minOrderKzt: 50_000,
    leadTimeDaysDefault: 9,
    reliabilityFactor: 1.2,
    baseUnitPriceKzt: 6500,
    verified: false,
  },

  // --- Полиграфия ---
  {
    seedKey: 'typopress-almaty',
    name: 'TypoPress Almaty',
    bin: '900540000111',
    taxMode: 'general',
    vatStatus: 'registered',
    city: 'Алматы',
    categories: ['printing'],
    capabilities: ['offset-print', 'binding'],
    minOrderKzt: 40_000,
    leadTimeDaysDefault: 6,
    reliabilityFactor: 1.0,
    baseUnitPriceKzt: 450,
    verified: true,
  },
  {
    seedKey: 'poligraf-servis',
    name: 'Полиграф Сервис',
    bin: '900540000122',
    taxMode: 'simplified',
    vatStatus: 'not_registered',
    city: 'Алматы',
    categories: ['printing'],
    capabilities: ['offset-print'],
    minOrderKzt: 25_000,
    leadTimeDaysDefault: 5,
    reliabilityFactor: 1.1,
    baseUnitPriceKzt: 380,
    verified: true,
  },
  {
    seedKey: 'printhouse-kz',
    name: 'PrintHouse KZ',
    bin: '900540000133',
    taxMode: 'general',
    vatStatus: 'registered',
    city: 'Алматы',
    categories: ['printing'],
    capabilities: ['offset-print', 'digital-print', 'binding'],
    minOrderKzt: 60_000,
    leadTimeDaysDefault: 8,
    reliabilityFactor: 0.95,
    baseUnitPriceKzt: 520,
    verified: true,
  },
  {
    seedKey: 'media-druk',
    name: 'Медиа Друк',
    bin: '900540000144',
    taxMode: 'simplified',
    vatStatus: 'not_registered',
    city: 'Караганда',
    categories: ['printing'],
    capabilities: ['digital-print'],
    minOrderKzt: 15_000,
    leadTimeDaysDefault: 7,
    reliabilityFactor: 1.15,
    baseUnitPriceKzt: 340,
    verified: true,
  },
  {
    seedKey: 'format-a1',
    name: 'Формат А1',
    bin: '900540000155',
    taxMode: 'general',
    vatStatus: 'registered',
    city: 'Алматы',
    categories: ['printing'],
    capabilities: ['large-format-print'],
    minOrderKzt: 30_000,
    leadTimeDaysDefault: 4,
    reliabilityFactor: 1.0,
    baseUnitPriceKzt: 2200,
    verified: true,
  },
];

export function suppliersInCategory(category: SeedCategory): SeedSupplier[] {
  return SEED_SUPPLIERS.filter((s) => s.categories.includes(category));
}
