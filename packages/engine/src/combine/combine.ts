import type { Explanation } from '../explain/types.js';
import { calculateSlackDays } from '../leadtime/predict.js';
import type { Kzt } from '../money/index.js';
import { percentOfKzt, roundKzt, sumKzt } from '../money/index.js';
import { calculateSnrTaxEffect, type SupplierTaxMode } from '../tax/snr.js';

/**
 * Комбинатор — agents.md §8D, сердце продукта.
 *
 * Задача — не "дешевле по каждой строке" (§7.1 запрещает это как основной
 * алгоритм), а выбор подмножества поставщиков с фиксированной ценой входа
 * (setup fee, отдельная отгрузка) и нелинейными скидками за комплект.
 * Один поставщик на весь заказ — легитимный и часто лучший результат,
 * потому что экономит на setup fee и консолидирует доставку в одну
 * отгрузку; наивный жадный алгоритм по строкам этот случай не находит
 * никогда — отсюда и обязательный тест-кейс в §15.
 */

export interface RequestItem {
  id: string;
  qty: number;
}

export interface QuoteOffer {
  id: string;
  requestItemId: string;
  supplierId: string;
  unitPriceKzt: Kzt;
  setupFeeKzt: Kzt;
  /** Заранее посчитанный buyer-side прогноз (leadtime.predictAfterQuote) — комбинатор не считает сроки сам. */
  predictedLeadDays: number;
  minQty: number | null;
  orderMultiple: number | null;
  bundleRule: { thresholdKzt: Kzt; discountPct: number } | null;
  capabilityConfirmed: boolean;
  hasOpenFieldFlags: boolean;
  /** ISO-дата или null (бессрочно). */
  validUntil: string | null;
  supplierTaxMode: SupplierTaxMode;
  /** Одна отгрузка на поставщика — стоимость уже посчитана вызывающим кодом по зоне/весу. */
  supplierDeliveryKzt: Kzt;
}

export type RejectionCode =
  | 'deadline_exceeded'
  | 'below_min_qty'
  | 'qty_not_multiple'
  | 'capability_not_confirmed'
  | 'open_field_flags'
  | 'quote_expired';

export interface PlanRejection {
  requestItemId: string;
  offerId: string;
  code: RejectionCode;
  reasonHuman: string;
}

export interface CombineInput {
  items: readonly RequestItem[];
  offers: readonly QuoteOffer[];
  /** ISO-дата дедлайна заказа. */
  deadlineDate: string;
  /** ISO-дата "сейчас" — передаётся явно, чтобы движок оставался чистой функцией. */
  today: string;
  /** База комиссии — % от стоимости товаров/услуг поставщиков без доставки (settings, agents.md §7.3). */
  commissionRatePct: number;
  /** Ставка КПН для эффекта СНР (settings, agents.md §11.4). */
  citRatePct: number;
  timeBudgetMs?: number;
}

export type PlanKind = 'recommended' | 'cheaper' | 'more_slack';

export interface PlanLine {
  requestItemId: string;
  offerId: string;
  supplierId: string;
  qty: number;
  lineTotalKzt: Kzt;
}

export interface PlanExplanation extends Explanation {
  comparedOffersCount: number;
  rejectedOffersCount: number;
}

export interface CombinedPlan {
  kind: PlanKind;
  lines: readonly PlanLine[];
  totalSupplierKzt: Kzt;
  deliveryKzt: Kzt;
  commissionKzt: Kzt;
  commissionBase: 'supplier_ex_delivery';
  taxEffectKzt: Kzt;
  totalKzt: Kzt;
  etaDays: number;
  slackDays: number;
  supplierCount: number;
  method: 'exact' | 'heuristic';
  explanation: PlanExplanation;
}

export interface CombineResult {
  plans: readonly CombinedPlan[];
  rejections: readonly PlanRejection[];
}

const EXACT_MAX_ITEMS = 12;
const EXACT_MAX_SUPPLIERS = 8;
const DEFAULT_TIME_BUDGET_MS = 300;
const MORE_SLACK_COST_TOLERANCE = 1.1;

// ---------------------------------------------------------------------------
// Шаг 1 — фильтр допустимости
// ---------------------------------------------------------------------------

function checkAdmissibility(
  item: RequestItem,
  offer: QuoteOffer,
  deadlineDate: string,
  today: string,
): RejectionCode | null {
  const deadline = new Date(deadlineDate).getTime();
  const start = new Date(today).getTime();
  const predictedArrival = start + offer.predictedLeadDays * 24 * 60 * 60 * 1000;
  if (predictedArrival > deadline) return 'deadline_exceeded';
  if (offer.minQty !== null && item.qty < offer.minQty) return 'below_min_qty';
  if (offer.orderMultiple !== null && item.qty % offer.orderMultiple !== 0) {
    return 'qty_not_multiple';
  }
  if (!offer.capabilityConfirmed) return 'capability_not_confirmed';
  if (offer.hasOpenFieldFlags) return 'open_field_flags';
  if (offer.validUntil !== null && new Date(offer.validUntil).getTime() < start) {
    return 'quote_expired';
  }
  return null;
}

const REJECTION_REASONS: Record<RejectionCode, string> = {
  deadline_exceeded: 'Прогноз срока поставки этого предложения не укладывается в дедлайн заказа',
  below_min_qty: 'Заказываемое количество меньше минимальной партии поставщика',
  qty_not_multiple: 'Заказываемое количество не кратно партии поставщика',
  capability_not_confirmed: 'Поставщик не подтвердил возможность исполнения этой позиции',
  open_field_flags: 'В предложении остались незакрытые уточнения по критичным полям',
  quote_expired: 'Срок действия коммерческого предложения истёк',
};

function filterAdmissible(input: CombineInput): {
  byItem: Map<string, QuoteOffer[]>;
  rejections: PlanRejection[];
} {
  const byItem = new Map<string, QuoteOffer[]>();
  const rejections: PlanRejection[] = [];
  const itemsById = new Map(input.items.map((i) => [i.id, i]));

  for (const offer of input.offers) {
    const item = itemsById.get(offer.requestItemId);
    if (!item) continue;
    const code = checkAdmissibility(item, offer, input.deadlineDate, input.today);
    if (code) {
      rejections.push({
        requestItemId: offer.requestItemId,
        offerId: offer.id,
        code,
        reasonHuman: REJECTION_REASONS[code],
      });
      continue;
    }
    const list = byItem.get(offer.requestItemId);
    if (list) list.push(offer);
    else byItem.set(offer.requestItemId, [offer]);
  }
  return { byItem, rejections };
}

// ---------------------------------------------------------------------------
// Стоимость полной сборки (используется и для точного, и для эвристического пути)
// ---------------------------------------------------------------------------

interface Assignment {
  requestItemId: string;
  offer: QuoteOffer;
  qty: number;
}

interface AssemblyCost {
  productSubtotalKzt: Kzt;
  bundleDiscountKzt: Kzt;
  setupFeeKzt: Kzt;
  totalSupplierKzt: Kzt;
  deliveryKzt: Kzt;
  commissionKzt: Kzt;
  etaDays: number;
  lines: PlanLine[];
}

function evaluateAssembly(
  assignments: readonly Assignment[],
  commissionRatePct: number,
): AssemblyCost {
  const perSupplierProduct = new Map<string, number>();
  for (const a of assignments) {
    const lineAmount = a.offer.unitPriceKzt * a.qty;
    perSupplierProduct.set(
      a.offer.supplierId,
      (perSupplierProduct.get(a.offer.supplierId) ?? 0) + lineAmount,
    );
  }

  const lines: PlanLine[] = [];
  let productSubtotalKzt = 0;
  let bundleDiscountKzt = 0;
  const deliveryBySupplier = new Map<string, number>();

  for (const a of assignments) {
    const lineAmount = a.offer.unitPriceKzt * a.qty;
    productSubtotalKzt += lineAmount;
    const rule = a.offer.bundleRule;
    const supplierTotal = perSupplierProduct.get(a.offer.supplierId) ?? 0;
    let discount = 0;
    if (rule && supplierTotal >= rule.thresholdKzt) {
      discount = roundKzt((lineAmount * rule.discountPct) / 100);
      bundleDiscountKzt += discount;
    }
    lines.push({
      requestItemId: a.requestItemId,
      offerId: a.offer.id,
      supplierId: a.offer.supplierId,
      qty: a.qty,
      lineTotalKzt: lineAmount - discount,
    });
    deliveryBySupplier.set(a.offer.supplierId, a.offer.supplierDeliveryKzt);
  }

  const setupFeeKzt = sumKzt(assignments.map((a) => a.offer.setupFeeKzt));
  const deliveryKzt = sumKzt([...deliveryBySupplier.values()]);
  const totalSupplierKzt = productSubtotalKzt - bundleDiscountKzt + setupFeeKzt;
  const commissionKzt = percentOfKzt(totalSupplierKzt, commissionRatePct);
  const etaDays =
    assignments.length > 0 ? Math.max(...assignments.map((a) => a.offer.predictedLeadDays)) : 0;

  return {
    productSubtotalKzt,
    bundleDiscountKzt,
    setupFeeKzt,
    totalSupplierKzt,
    deliveryKzt,
    commissionKzt,
    etaDays,
    lines,
  };
}

function totalCostOf(assembly: AssemblyCost): Kzt {
  return assembly.totalSupplierKzt + assembly.deliveryKzt + assembly.commissionKzt;
}

// ---------------------------------------------------------------------------
// Точный путь — перебор подмножеств поставщиков + DFS с ветвями и границами
// ---------------------------------------------------------------------------

function enumerateNonEmptySubsets(suppliers: readonly string[]): string[][] {
  const subsets: string[][] = [];
  const n = suppliers.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const subset: string[] = [];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        const s = suppliers[i];
        if (s !== undefined) subset.push(s);
      }
    }
    subsets.push(subset);
  }
  return subsets;
}

// ---------------------------------------------------------------------------
// Эвристический путь — жадное назначение + 2-opt
// ---------------------------------------------------------------------------

function greedyAssignment(
  itemIds: readonly string[],
  offersByItem: ReadonlyMap<string, QuoteOffer[]>,
  itemQtyById: ReadonlyMap<string, number>,
): Assignment[] | null {
  const assignments: Assignment[] = [];
  for (const id of itemIds) {
    const offers = offersByItem.get(id) ?? [];
    if (offers.length === 0) return null;
    const cheapest = offers.reduce((a, b) => (b.unitPriceKzt < a.unitPriceKzt ? b : a));
    assignments.push({ requestItemId: id, offer: cheapest, qty: itemQtyById.get(id) ?? 0 });
  }
  return assignments;
}

function twoOptImprove(
  initial: Assignment[],
  offersByItem: ReadonlyMap<string, QuoteOffer[]>,
  commissionRatePct: number,
  deadlineAt: number,
): Assignment[] {
  let current = initial;
  let currentCost = totalCostOf(evaluateAssembly(current, commissionRatePct));
  let improved = true;

  while (improved && Date.now() < deadlineAt) {
    improved = false;
    for (let i = 0; i < current.length; i++) {
      const a = current[i];
      if (!a) continue;
      const alternatives = offersByItem.get(a.requestItemId) ?? [];
      for (const alt of alternatives) {
        if (alt.id === a.offer.id) continue;
        const candidate = [...current];
        candidate[i] = { ...a, offer: alt };
        const candidateCost = totalCostOf(evaluateAssembly(candidate, commissionRatePct));
        if (candidateCost < currentCost) {
          current = candidate;
          currentCost = candidateCost;
          improved = true;
        }
      }
      if (Date.now() >= deadlineAt) break;
    }
  }
  return current;
}

// ---------------------------------------------------------------------------
// Точка входа
// ---------------------------------------------------------------------------

export function combine(input: CombineInput): CombineResult {
  const { byItem, rejections } = filterAdmissible(input);
  const itemQtyById = new Map(input.items.map((i) => [i.id, i.qty]));
  const itemIds = input.items.map((i) => i.id);

  if (itemIds.some((id) => (byItem.get(id) ?? []).length === 0)) {
    // Хотя бы одна позиция не имеет ни одного допустимого предложения —
    // собрать план из всего заказа невозможно.
    return { plans: [], rejections };
  }

  const supplierIds = [...new Set(input.offers.map((o) => o.supplierId))].filter((sid) =>
    input.offers.some(
      (o) => o.supplierId === sid && (byItem.get(o.requestItemId) ?? []).includes(o),
    ),
  );

  const timeBudgetMs = input.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const deadlineAt = Date.now() + timeBudgetMs;
  const useExact = itemIds.length <= EXACT_MAX_ITEMS && supplierIds.length <= EXACT_MAX_SUPPLIERS;

  const candidates: { assignments: Assignment[]; method: 'exact' | 'heuristic' }[] = [];

  if (useExact) {
    const subsets = enumerateNonEmptySubsets(supplierIds);
    for (const subset of subsets) {
      if (Date.now() > deadlineAt) break;
      const subsetSet = new Set(subset);
      const offersByItemInSubset = new Map<string, QuoteOffer[]>();
      for (const id of itemIds) {
        offersByItemInSubset.set(
          id,
          (byItem.get(id) ?? []).filter((o) => subsetSet.has(o.supplierId)),
        );
      }
      const result = solveSubsetExact(
        itemIds,
        offersByItemInSubset,
        itemQtyById,
        input.commissionRatePct,
        deadlineAt,
      );
      if (result) candidates.push({ assignments: result, method: 'exact' });
    }
  }

  if (candidates.length === 0) {
    const greedy = greedyAssignment(itemIds, byItem, itemQtyById);
    if (greedy) {
      const improved = twoOptImprove(greedy, byItem, input.commissionRatePct, deadlineAt);
      candidates.push({ assignments: improved, method: 'heuristic' });
    }
  }

  if (candidates.length === 0) return { plans: [], rejections };

  const startDate = new Date(input.today);
  const deadlineDate = new Date(input.deadlineDate);

  const scored = candidates.map((c) => {
    const assembly = evaluateAssembly(c.assignments, input.commissionRatePct);
    const totalKzt = totalCostOf(assembly);
    const slackDays = calculateSlackDays(startDate, assembly.etaDays, deadlineDate);
    const taxEffect = calculateSnrTaxEffect(
      c.assignments.map((a) => ({
        supplierTaxMode: a.offer.supplierTaxMode,
        lineCostKzt: a.offer.unitPriceKzt * a.qty,
      })),
      input.citRatePct,
    );
    const supplierCount = new Set(c.assignments.map((a) => a.offer.supplierId)).size;
    return { ...c, assembly, totalKzt, slackDays, taxEffect, supplierCount };
  });

  const recommendedPool = scored.filter((s) => s.slackDays >= 3);
  const recommended = (recommendedPool.length > 0 ? recommendedPool : scored).reduce((a, b) =>
    b.totalKzt < a.totalKzt ? b : a,
  );
  const cheaper = scored.reduce((a, b) => (b.totalKzt < a.totalKzt ? b : a));
  const slackTolerance = recommended.totalKzt * MORE_SLACK_COST_TOLERANCE;
  const moreSlackPool = scored.filter((s) => s.totalKzt <= slackTolerance);
  const moreSlack = moreSlackPool.reduce((a, b) => (b.slackDays > a.slackDays ? b : a));

  const chosen = new Map<PlanKind, (typeof scored)[number]>();
  chosen.set('recommended', recommended);
  if (cheaper.totalKzt < recommended.totalKzt) chosen.set('cheaper', cheaper);
  if (moreSlack.slackDays > recommended.slackDays) chosen.set('more_slack', moreSlack);

  const plans: CombinedPlan[] = [...chosen.entries()].map(([kind, s]) => ({
    kind,
    lines: s.assembly.lines,
    totalSupplierKzt: s.assembly.totalSupplierKzt,
    deliveryKzt: s.assembly.deliveryKzt,
    commissionKzt: s.assembly.commissionKzt,
    commissionBase: 'supplier_ex_delivery',
    taxEffectKzt: s.taxEffect.effectKzt,
    totalKzt: s.totalKzt,
    etaDays: s.assembly.etaDays,
    slackDays: s.slackDays,
    supplierCount: s.supplierCount,
    method: s.method,
    explanation: {
      decomposition: [
        { label: 'Товары и услуги поставщиков', amountKzt: s.assembly.productSubtotalKzt },
        { label: 'Скидка за комплект', amountKzt: -s.assembly.bundleDiscountKzt },
        { label: 'Настройка/установка (setup fee)', amountKzt: s.assembly.setupFeeKzt },
        { label: 'Доставка', amountKzt: s.assembly.deliveryKzt },
        { label: 'Комиссия QAJET', amountKzt: s.assembly.commissionKzt },
      ],
      comparedOffersCount: input.offers.length,
      rejectedOffersCount: rejections.length,
      notes: [],
    },
  }));

  return { plans, rejections };
}

function solveSubsetExact(
  itemIds: readonly string[],
  offersByItemInSubset: ReadonlyMap<string, QuoteOffer[]>,
  itemQtyById: ReadonlyMap<string, number>,
  commissionRatePct: number,
  deadlineAt: number,
): Assignment[] | null {
  for (const id of itemIds) {
    if ((offersByItemInSubset.get(id) ?? []).length === 0) return null;
  }

  let maxDiscountPct = 0;
  for (const offers of offersByItemInSubset.values()) {
    for (const o of offers) {
      if (o.bundleRule && o.bundleRule.discountPct > maxDiscountPct) {
        maxDiscountPct = o.bundleRule.discountPct;
      }
    }
  }

  const remainingMinCost = new Array<number>(itemIds.length + 1).fill(0);
  for (let i = itemIds.length - 1; i >= 0; i--) {
    const id = itemIds[i];
    const offers = id !== undefined ? (offersByItemInSubset.get(id) ?? []) : [];
    const qty = id !== undefined ? (itemQtyById.get(id) ?? 0) : 0;
    const cheapestLine =
      offers.length > 0 ? Math.min(...offers.map((o) => o.unitPriceKzt * qty)) : 0;
    const prev = remainingMinCost[i + 1] ?? 0;
    remainingMinCost[i] = prev + cheapestLine;
  }

  let best: { assignments: Assignment[]; cost: number } | null = null;
  const current: Assignment[] = [];

  function dfs(index: number, accumulatedProductCost: number): void {
    if (Date.now() > deadlineAt) return;
    if (index === itemIds.length) {
      const cost = totalCostOf(evaluateAssembly(current, commissionRatePct));
      if (!best || cost < best.cost) best = { assignments: [...current], cost };
      return;
    }

    const remainingBound = remainingMinCost[index + 1] ?? 0;
    const optimisticRemaining = remainingBound * (1 - maxDiscountPct / 100);
    if (
      best !== null &&
      accumulatedProductCost + optimisticRemaining >= (best as { cost: number }).cost
    ) {
      return;
    }

    const id = itemIds[index];
    if (id === undefined) return;
    const offers = offersByItemInSubset.get(id) ?? [];
    const qty = itemQtyById.get(id) ?? 0;

    for (const offer of offers) {
      current.push({ requestItemId: id, offer, qty });
      dfs(index + 1, accumulatedProductCost + offer.unitPriceKzt * qty);
      current.pop();
    }
  }

  dfs(0, 0);
  return best === null ? null : (best as { assignments: Assignment[]; cost: number }).assignments;
}
