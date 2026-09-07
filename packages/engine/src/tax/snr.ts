import type { Kzt } from '../money/index.js';
import { roundKzt, sumKzt } from '../money/index.js';

/**
 * Эффект СНР — agents.md §11.4.
 *
 * С 2026 года расходы на товары, работы и услуги у поставщика на СНР на
 * основе упрощённой декларации НЕ подлежат вычету при исчислении КПН.
 * Значит купить дешевле у такого поставщика может быть дороже по факту:
 * покупатель теряет вычет, который получил бы у поставщика на общем режиме.
 *
 * Это показывается отдельной строкой сравнения, НЕ в цене варианта —
 * решение о значимости эффекта и его правовых последствиях остаётся за
 * бухгалтером покупателя, engine только считает и объясняет цифру.
 */

export type SupplierTaxMode = 'general' | 'simplified' | 'retail' | 'unknown';

export interface TaxEffectLine {
  supplierTaxMode: SupplierTaxMode;
  /** Стоимость товаров/работ/услуг по этой строке — без доставки и комиссии. */
  lineCostKzt: Kzt;
}

export interface TaxEffectExplanation {
  /** Итоговый эффект по вычету КПН для покупателя, тенге. */
  effectKzt: Kzt;
  /** Ставка КПН, применённая к расчёту (settings, не константа в коде). */
  citRatePct: number;
  /** Сумма закупки у поставщиков на упрощённой декларации, из которой считается эффект. */
  affectedCostKzt: Kzt;
  /** Оговорка для интерфейса — правовые последствия подтверждает бухгалтер клиента. */
  disclaimer: string;
}

const DISCLAIMER =
  'Эффект по вычету КПН — техническая оценка на основе налогового режима поставщика. ' +
  'Правовые последствия сделки подтверждает бухгалтер покупателя.';

/**
 * Считает эффект по вычету КПН для набора строк варианта.
 * `citRatePct` обязателен и берётся из settings у вызывающего кода —
 * это экономический параметр, а не константа движка (agents.md §9).
 */
export function calculateSnrTaxEffect(
  lines: readonly TaxEffectLine[],
  citRatePct: number,
): TaxEffectExplanation {
  const affected = lines.filter((l) => l.supplierTaxMode === 'simplified');
  const affectedCostKzt = sumKzt(affected.map((l) => l.lineCostKzt));
  const effectKzt = roundKzt((affectedCostKzt * citRatePct) / 100);

  return {
    effectKzt,
    citRatePct,
    affectedCostKzt,
    disclaimer: DISCLAIMER,
  };
}
