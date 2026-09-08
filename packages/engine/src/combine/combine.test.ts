import { describe, expect, it } from 'vitest';
import { __debugStats, type CombineInput, combine, type QuoteOffer } from './combine.js';

const TODAY = '2026-09-01T00:00:00Z';

function addDaysIso(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function offer(
  partial: Partial<QuoteOffer> &
    Pick<QuoteOffer, 'id' | 'requestItemId' | 'supplierId' | 'unitPriceKzt'>,
): QuoteOffer {
  return {
    setupFeeKzt: 0,
    predictedLeadDays: 5,
    minQty: null,
    orderMultiple: null,
    bundleRule: null,
    capabilityConfirmed: true,
    hasOpenFieldFlags: false,
    validUntil: null,
    supplierTaxMode: 'general',
    supplierDeliveryKzt: 0,
    ...partial,
  };
}

const baseInput = {
  today: TODAY,
  deadlineDate: addDaysIso(TODAY, 20),
  commissionRatePct: 5,
  citRatePct: 20,
};

describe('combine — обязательный кейс §15: один поставщик выгоднее трёх', () => {
  it('план с одним поставщиком (консолидированная доставка + скидка за комплект) выигрывает у трёх дешёвых построчно', () => {
    const items = [
      { id: 'item-1', qty: 10 },
      { id: 'item-2', qty: 10 },
      { id: 'item-3', qty: 10 },
    ];

    const offers: QuoteOffer[] = [
      // Поставщик A закрывает весь заказ: дороже за единицу, но одна отгрузка
      // и скидка за комплект при пороге 20 000 тг совокупно.
      offer({
        id: 'a-1',
        requestItemId: 'item-1',
        supplierId: 'supplier-a',
        unitPriceKzt: 1000,
        supplierDeliveryKzt: 5000,
        bundleRule: { thresholdKzt: 20_000, discountPct: 10 },
      }),
      offer({
        id: 'a-2',
        requestItemId: 'item-2',
        supplierId: 'supplier-a',
        unitPriceKzt: 1000,
        supplierDeliveryKzt: 5000,
        bundleRule: { thresholdKzt: 20_000, discountPct: 10 },
      }),
      offer({
        id: 'a-3',
        requestItemId: 'item-3',
        supplierId: 'supplier-a',
        unitPriceKzt: 1000,
        supplierDeliveryKzt: 5000,
        bundleRule: { thresholdKzt: 20_000, discountPct: 10 },
      }),
      // Поставщики B/C/D — каждый на 10% дешевле за единицу по своей строке,
      // но своя отгрузка и свой setup fee на каждого.
      offer({
        id: 'b-1',
        requestItemId: 'item-1',
        supplierId: 'supplier-b',
        unitPriceKzt: 900,
        setupFeeKzt: 500,
        supplierDeliveryKzt: 4000,
      }),
      offer({
        id: 'c-2',
        requestItemId: 'item-2',
        supplierId: 'supplier-c',
        unitPriceKzt: 900,
        setupFeeKzt: 500,
        supplierDeliveryKzt: 4000,
      }),
      offer({
        id: 'd-3',
        requestItemId: 'item-3',
        supplierId: 'supplier-d',
        unitPriceKzt: 900,
        setupFeeKzt: 500,
        supplierDeliveryKzt: 4000,
      }),
    ];

    const input: CombineInput = { ...baseInput, items, offers };
    const result = combine(input);

    expect(result.plans.length).toBeGreaterThan(0);
    const recommended = result.plans.find((p) => p.kind === 'recommended');
    expect(recommended).toBeDefined();
    expect(recommended?.supplierCount).toBe(1);
    expect(recommended?.lines.every((l) => l.supplierId === 'supplier-a')).toBe(true);

    // Наивная сумма "дешевле по каждой строке" (B+C+D) — контрольное число,
    // которое recommended обязан побить, иначе алгоритм скатился в §7.1.
    const naiveLineByLineTotal = 9000 * 3 + 500 * 3 + 4000 * 3; // товары + setup + доставка, без комиссии
    expect((recommended?.totalSupplierKzt ?? 0) + (recommended?.deliveryKzt ?? 0)).toBeLessThan(
      naiveLineByLineTotal,
    );
  });
});

describe('combine — обязательный кейс §15: эффект СНР меняет победителя', () => {
  it('более дешёвый оффер у поставщика на упрощённой декларации становится невыгоднее после эффекта по вычету КПН', () => {
    const items = [{ id: 'item-1', qty: 10 }];
    const offers: QuoteOffer[] = [
      offer({
        id: 'x-1',
        requestItemId: 'item-1',
        supplierId: 'supplier-x',
        unitPriceKzt: 900,
        supplierDeliveryKzt: 1000,
        predictedLeadDays: 5,
        supplierTaxMode: 'simplified',
      }),
      offer({
        id: 'y-1',
        requestItemId: 'item-1',
        supplierId: 'supplier-y',
        unitPriceKzt: 1000,
        supplierDeliveryKzt: 1000,
        predictedLeadDays: 2,
        supplierTaxMode: 'general',
      }),
    ];

    const input: CombineInput = { ...baseInput, items, offers, commissionRatePct: 0 };
    const result = combine(input);

    const recommended = result.plans.find((p) => p.kind === 'recommended');
    const moreSlack = result.plans.find((p) => p.kind === 'more_slack');
    expect(recommended?.lines[0]?.supplierId).toBe('supplier-x');
    expect(moreSlack?.lines[0]?.supplierId).toBe('supplier-y');

    expect(recommended?.taxEffectKzt).toBeGreaterThan(0);
    expect(moreSlack?.taxEffectKzt).toBe(0);

    // По голой цене recommended (x) дешевле — но с учётом эффекта СНР
    // реальная стоимость x превышает реальную стоимость y. Продукт обязан
    // показать это отдельной строкой, а не спрятать за более низкой ценой.
    expect(recommended?.totalKzt ?? 0).toBeLessThan(moreSlack?.totalKzt ?? 0);
    const effectiveRecommended = (recommended?.totalKzt ?? 0) + (recommended?.taxEffectKzt ?? 0);
    const effectiveMoreSlack = (moreSlack?.totalKzt ?? 0) + (moreSlack?.taxEffectKzt ?? 0);
    expect(effectiveRecommended).toBeGreaterThan(effectiveMoreSlack);
  });
});

describe('combine — три варианта', () => {
  it('recommended требует slack ≥ 3, cheaper — нет (при соблюдении обязательных условий)', () => {
    const items = [{ id: 'item-1', qty: 1 }];
    const offers: QuoteOffer[] = [
      offer({
        id: 'p-1',
        requestItemId: 'item-1',
        supplierId: 'supplier-p',
        unitPriceKzt: 100,
        predictedLeadDays: 9, // дедлайн через 10 дней → slack = 1
      }),
      offer({
        id: 'q-1',
        requestItemId: 'item-1',
        supplierId: 'supplier-q',
        unitPriceKzt: 150,
        predictedLeadDays: 5, // slack = 5
      }),
    ];

    const input: CombineInput = {
      today: TODAY,
      deadlineDate: addDaysIso(TODAY, 10),
      commissionRatePct: 0,
      citRatePct: 20,
      items,
      offers,
    };
    const result = combine(input);

    const kinds = result.plans.map((p) => p.kind).sort();
    expect(kinds).toEqual(['cheaper', 'recommended']);

    const recommended = result.plans.find((p) => p.kind === 'recommended');
    const cheaper = result.plans.find((p) => p.kind === 'cheaper');
    expect(recommended?.lines[0]?.supplierId).toBe('supplier-q');
    expect(cheaper?.lines[0]?.supplierId).toBe('supplier-p');
    expect(cheaper?.slackDays).toBeLessThan(3);
    expect(recommended?.slackDays).toBeGreaterThanOrEqual(3);
  });
});

describe('combine — отсечение между подмножествами (Волна B.1)', () => {
  it('глобальная граница режет перебор на дорогих подмножествах, план остаётся верным', () => {
    const items = Array.from({ length: 6 }, (_, i) => ({ id: `item-${i}`, qty: 5 }));
    const supplierIds = Array.from({ length: 8 }, (_, i) => `supplier-${i}`);

    const offers: QuoteOffer[] = [];
    for (const item of items) {
      for (const [si, supplierId] of supplierIds.entries()) {
        // supplier-0 доминирует по цене на каждой позиции — его собственное
        // подмножество (обрабатывается первым, единственный элемент в
        // supplierIds) должно быстро дать сильную глобальную границу.
        const unitPriceKzt = si === 0 ? 100 : 1000 + si * 50;
        offers.push(
          offer({
            id: `${supplierId}-${item.id}`,
            requestItemId: item.id,
            supplierId,
            unitPriceKzt,
          }),
        );
      }
    }

    const input: CombineInput = { ...baseInput, items, offers, timeBudgetMs: 5000 };
    const result = combine(input);

    const recommended = result.plans.find((p) => p.kind === 'recommended');
    expect(recommended?.lines.every((l) => l.supplierId === 'supplier-0')).toBe(true);

    // Регрессионный потолок: на этом входе (8 поставщиков × 6 позиций)
    // с отсечением между подмножествами — около 1300 вызовов
    // evaluateAssembly; без него (globalBest никогда не обновляется) —
    // около 940 000, то есть на два с лишним порядка больше. Если кто-то
    // в будущем уберёт globalBest из solveSubsetExact, этот тест должен
    // покраснеть, а не молча остаться зелёным на честном "правильный
    // ответ, но перебор снова полный".
    expect(__debugStats.evaluateAssemblyCalls).toBeLessThan(5000);
  });
});

describe('combine — фильтр допустимости и журнал отбраковки', () => {
  it('оффер, не укладывающийся в дедлайн, отбраковывается с человеческой причиной и не участвует в плане', () => {
    const items = [{ id: 'item-1', qty: 1 }];
    const offers: QuoteOffer[] = [
      offer({
        id: 'late-1',
        requestItemId: 'item-1',
        supplierId: 'supplier-late',
        unitPriceKzt: 50,
        predictedLeadDays: 30, // дедлайн через 5 дней — не успевает
      }),
      offer({
        id: 'ontime-1',
        requestItemId: 'item-1',
        supplierId: 'supplier-ontime',
        unitPriceKzt: 200,
        predictedLeadDays: 2,
      }),
    ];

    const input: CombineInput = {
      today: TODAY,
      deadlineDate: addDaysIso(TODAY, 5),
      commissionRatePct: 0,
      citRatePct: 20,
      items,
      offers,
    };
    const result = combine(input);

    expect(result.rejections).toEqual([
      {
        requestItemId: 'item-1',
        offerId: 'late-1',
        code: 'deadline_exceeded',
        reasonHuman: expect.stringContaining('дедлайн'),
      },
    ]);
    expect(result.plans.every((p) => p.lines.every((l) => l.offerId !== 'late-1'))).toBe(true);
  });

  it('позиция без единого допустимого предложения — план собрать нельзя, но функция не падает', () => {
    const items = [{ id: 'item-1', qty: 1 }];
    const offers: QuoteOffer[] = [
      offer({
        id: 'only-1',
        requestItemId: 'item-1',
        supplierId: 'supplier-only',
        unitPriceKzt: 100,
        capabilityConfirmed: false,
      }),
    ];

    const result = combine({ ...baseInput, items, offers });
    expect(result.plans).toEqual([]);
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0]?.code).toBe('capability_not_confirmed');
  });
});
