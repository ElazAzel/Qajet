import { calculateSettlement } from '@qajet/engine/settlement';
import { describe, expect, it } from 'vitest';
import { generateSeedDataset } from './generator.js';
import { SEED_SUPPLIERS } from './suppliers.js';

/**
 * Инварианты сида — agents.md §13. Без реальной БД: чистые функции,
 * проверяем форму сгенерированного графа данных, а не побочные эффекты.
 */

const PARAMS = { seed: 42, referenceDateIso: '2026-09-07' };

describe('generateSeedDataset', () => {
  it('детерминирован — два прогона с одним зерном дают идентичный результат', () => {
    // id — randomUUID(), заведомо разный между прогонами; детерминизм проверяем
    // по содержимому, не зависящему от случайных идентификаторов.
    const summarize = (d: ReturnType<typeof generateSeedDataset>) => ({
      orderStates: d.orders.map((o) => o.state).sort(),
      finalCosts: d.orders.map((o) => o.finalCostKzt).filter((v) => v !== null),
      priceObservations: d.priceObservations.map((o) => [
        o.category,
        o.itemKey,
        o.qty,
        o.unitPriceKzt,
      ]),
      modelSnapshotMetrics: d.modelSnapshots.map((s) => [
        s.model,
        s.nSamples,
        JSON.stringify(s.metrics),
      ]),
    });
    const a = summarize(generateSeedDataset(PARAMS));
    const b = summarize(generateSeedDataset(PARAMS));
    expect(a).toEqual(b);
  });

  it('минимум 3 поставщика из 15 на упрощённой декларации (agents.md §13)', () => {
    const simplified = SEED_SUPPLIERS.filter((s) => s.taxMode === 'simplified');
    expect(simplified.length).toBeGreaterThanOrEqual(3);
    expect(SEED_SUPPLIERS).toHaveLength(15);
  });

  it('ровно 24 закрытых заказа', () => {
    const dataset = generateSeedDataset(PARAMS);
    const closed = dataset.orders.filter((o) => o.state === 'closed');
    expect(closed).toHaveLength(24);
  });

  it('по заказу на каждой оставшейся стадии жизненного цикла', () => {
    const dataset = generateSeedDataset(PARAMS);
    const states = [
      'draft',
      'estimated',
      'prepaid',
      'rfq_sent',
      'plan_proposed',
      'plan_approved',
      'suppliers_paid',
      'in_production',
      'shipped',
      'delivered',
      'accepted',
      'awaiting_internal_approval',
      'on_hold',
      'cancelled',
      'disputed',
    ] as const;
    for (const state of states) {
      const count = dataset.orders.filter((o) => o.state === state).length;
      expect(count, `стадия ${state}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('демо-заказ quotes_received: 6 позиций, 5 КП, 2 с пропущенными полями, 1 с невыполнимым сроком', () => {
    const dataset = generateSeedDataset(PARAMS);
    const demoOrder = dataset.orders.find((o) => o.state === 'quotes_received');
    expect(demoOrder).toBeDefined();
    if (!demoOrder) return;

    const items = dataset.requestItems.filter((ri) => ri.requestId === demoOrder.requestId);
    expect(items).toHaveLength(6);

    const rfqIds = new Set(
      dataset.rfqs.filter((r) => r.requestId === demoOrder.requestId).map((r) => r.id),
    );
    const quotes = dataset.quotes.filter((q) => rfqIds.has(q.rfqId));
    expect(quotes).toHaveLength(5);

    const quoteIds = new Set(quotes.map((q) => q.id));
    const lines = dataset.quoteLines.filter((l) => quoteIds.has(l.quoteId));

    const linesWithMissingFields = lines.filter((l) => {
      const flags = l.fieldFlags as { missing?: string[] } | null;
      return flags && Array.isArray(flags.missing) && flags.missing.length > 0;
    });
    const quotesWithMissingLine = new Set(linesWithMissingFields.map((l) => l.quoteId));
    expect(quotesWithMissingLine.size).toBe(2);

    const impossibleLines = lines.filter((l) => l.leadTimeDays > 30);
    expect(impossibleLines.length).toBeGreaterThan(0);

    // Нет ни плана, ни принятого заказа — демо-сцена именно на этой точке.
    expect(demoOrder.approvedPlanId).toBeDefined();
    const plan = dataset.plans.find((pl) => pl.id === demoOrder.approvedPlanId);
    expect(plan?.status).toBe('draft');
  });

  it('price_observations покрывают ~9 месяцев истории', () => {
    const dataset = generateSeedDataset(PARAMS);
    expect(dataset.priceObservations.length).toBeGreaterThan(0);
    const dates = dataset.priceObservations.map((o) =>
      new Date(o.observedAt as unknown as string | Date).getTime(),
    );
    const spanDays = (Math.max(...dates) - Math.min(...dates)) / (24 * 60 * 60 * 1000);
    expect(spanDays).toBeGreaterThan(200);
  });

  it('9 месячных снимков на каждую из трёх моделей', () => {
    const dataset = generateSeedDataset(PARAMS);
    for (const model of ['estimator', 'matcher', 'leadtime'] as const) {
      const count = dataset.modelSnapshots.filter((s) => s.model === model).length;
      expect(count, `модель ${model}`).toBe(9);
    }
  });

  it('запас (marginPct) в среднем снижается со временем — по всем трём категориям', () => {
    const dataset = generateSeedDataset(PARAMS);
    const estimatorSnapshots = dataset.modelSnapshots
      .filter((s) => s.model === 'estimator')
      .sort(
        (a, b) =>
          new Date(a.trainedAt as unknown as string).getTime() -
          new Date(b.trainedAt as unknown as string).getTime(),
      );
    expect(estimatorSnapshots).toHaveLength(9);

    const avgMargin = (snap: (typeof estimatorSnapshots)[number]): number => {
      const byCategory = (snap.metrics as { byCategory: { marginPct: number }[] }).byCategory;
      return byCategory.reduce((s, c) => s + c.marginPct, 0) / byCategory.length;
    };
    // Первые 3 снимка (ранняя история) против последних 3 (зрелая история) —
    // усреднение сглаживает шум отдельного месяца/категории с малым N, но
    // сохраняет проверку самого тренда, требуемого agents.md §13.
    const earlyAvg = estimatorSnapshots.slice(0, 3).reduce((s, snap) => s + avgMargin(snap), 0) / 3;
    const lateAvg = estimatorSnapshots.slice(-3).reduce((s, snap) => s + avgMargin(snap), 0) / 3;
    expect(lateAvg).toBeLessThan(earlyAvg);
  });

  it('изоляция поставщиков сохраняется на уровне данных: quote_lines ссылаются только на свой quote', () => {
    const dataset = generateSeedDataset(PARAMS);
    const quoteById = new Map(dataset.quotes.map((q) => [q.id, q]));
    for (const line of dataset.quoteLines) {
      expect(quoteById.has(line.quoteId)).toBe(true);
    }
  });

  it('5 демо-аккаунтов, 4 из них — быстрый вход, у 2 сотрудников покупателя разные лимиты согласования', () => {
    const dataset = generateSeedDataset(PARAMS);
    expect(dataset.accounts).toHaveLength(5);
    expect(dataset.accounts.filter((a) => a.isQuickLogin)).toHaveLength(4);
    const buyerStaff = dataset.users.filter(
      (u) => u.companyId === dataset.companies.find((c) => c.type === 'buyer')?.id,
    );
    expect(buyerStaff).toHaveLength(2);
    const limits = new Set(buyerStaff.map((u) => u.approvalLimitKzt));
    expect(limits.size).toBe(2);
  });

  it('переиспользует существующие компанию/аккаунты вместо дублирования (повторный прогон против непустой БД)', () => {
    const existingBuyerCompanyId = 'aaaaaaaa-0000-0000-0000-000000000001';
    const existingSupplierCompanyId = 'aaaaaaaa-0000-0000-0000-000000000002';
    const existingBuyerUserId = 'aaaaaaaa-0000-0000-0000-000000000003';
    const dataset = generateSeedDataset({
      ...PARAMS,
      existing: {
        buyerCompanyId: existingBuyerCompanyId,
        supplierCompanyId: existingSupplierCompanyId,
        accountsByEmail: { 'buyer@demo.qajet.kz': existingBuyerUserId },
      },
    });

    // Ни компания-покупатель, ни существующий аккаунт не вставляются заново.
    expect(dataset.companies.some((c) => c.id === existingBuyerCompanyId)).toBe(false);
    expect(dataset.users.some((u) => u.id === existingBuyerUserId)).toBe(false);

    const buyerAccount = dataset.accounts.find((a) => a.seedKey === 'demo-buyer');
    expect(buyerAccount?.userId).toBe(existingBuyerUserId);
    expect(buyerAccount?.isNew).toBe(false);
    expect(buyerAccount?.companyId).toBe(existingBuyerCompanyId);

    const supplierAccount = dataset.accounts.find((a) => a.seedKey === 'demo-supplier');
    expect(supplierAccount?.companyId).toBe(existingSupplierCompanyId);
    expect(supplierAccount?.isNew).toBe(true);

    // Все заявки покупателя ссылаются на переданный id, а не на новый сгенерированный.
    expect(dataset.requests.every((r) => r.buyerCompanyId === existingBuyerCompanyId)).toBe(true);
  });
  it('пишет учёт времени только для консьержа и по всем стадиям §9, с падающим трендом', () => {
    const dataset = generateSeedDataset(PARAMS);
    const conciergeUserId = dataset.accounts.find((a) => a.seedKey === 'demo-concierge')?.userId;

    expect(dataset.timeEntries.length).toBeGreaterThan(0);
    // Покупатель не тратит время QAJET — RLS всё равно пустила бы только staff.
    expect(dataset.timeEntries.every((t) => t.userId === conciergeUserId)).toBe(true);

    // Активные часы, а не календарные: стадия «производство» идёт неделю,
    // но записи по ней обязаны оставаться в пределах рабочих часов.
    const hoursByOrder = new Map<string, number>();
    for (const entry of dataset.timeEntries) {
      const key = entry.orderId as string;
      hoursByOrder.set(key, (hoursByOrder.get(key) ?? 0) + (entry.seconds as number) / 3600);
    }
    for (const hours of hoursByOrder.values()) expect(hours).toBeLessThan(12);

    // §13, сцена 8: «часы на заказ падают».
    const closed = dataset.orders.filter((o) => o.state === 'closed');
    const hoursOf = (o: (typeof closed)[number]) => hoursByOrder.get(o.id as string) ?? 0;
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(closed.slice(-8).map(hoursOf))).toBeLessThan(mean(closed.slice(0, 8).map(hoursOf)));
  });

  it('заполняет треды, сообщения, доступы и запрос на изменение плана', () => {
    const dataset = generateSeedDataset(PARAMS);

    expect(dataset.threads.length).toBeGreaterThan(0);
    expect(dataset.messages.length).toBeGreaterThan(0);
    // Внутренние заметки существуют и отделены от переписки с покупателем.
    expect(dataset.threads.some((t) => t.kind === 'internal')).toBe(true);
    expect(dataset.threads.some((t) => t.kind === 'buyer')).toBe(true);

    const threadIds = new Set(dataset.threads.map((t) => t.id as string));
    expect(dataset.messages.every((m) => threadIds.has(m.threadId as string))).toBe(true);

    // §10 «Команда и доступы»: право управлять командой есть только у владельца.
    const manageTeam = dataset.permissions.filter((p) => p.key === 'can_manage_team');
    expect(manageTeam.length).toBeGreaterThan(1);
    expect(manageTeam.filter((p) => p.value === true)).toHaveLength(1);

    // §15: изменение утверждённого плана существует как отдельная сущность.
    expect(dataset.changeRequests.length).toBeGreaterThan(0);
  });

  it('финансовые строки сида сходятся с планами и не маскируют деньги статусами', () => {
    const dataset = generateSeedDataset(PARAMS);
    const linesByPlan = new Map<string, typeof dataset.planLines>();
    for (const line of dataset.planLines) {
      const lines = linesByPlan.get(line.planId as string) ?? [];
      lines.push(line);
      linesByPlan.set(line.planId as string, lines);
    }

    for (const plan of dataset.plans) {
      const lines = linesByPlan.get(plan.id as string) ?? [];
      if (lines.length === 0) continue;
      expect(
        lines.reduce((sum, line) => sum + (line.lineTotalKzt as number), 0),
        `план ${plan.id}: строки поставщиков`,
      ).toBe(plan.totalSupplierKzt);
      expect(
        lines.reduce((sum, line) => sum + (line.commissionKzt as number), 0),
        `план ${plan.id}: комиссии строк`,
      ).toBe(plan.commissionKzt);
      expect(plan.totalKzt).toBe(
        plan.totalSupplierKzt +
          plan.deliveryKzt +
          plan.commissionKzt +
          (plan.supplierRebateKzt ?? 0),
      );
    }

    const confirmedFacts = dataset.paymentFacts.filter((fact) => fact.status === 'confirmed');
    expect(new Set(confirmedFacts.map((fact) => fact.idempotencyKey)).size).toBe(
      confirmedFacts.length,
    );

    for (const prepayment of dataset.prepayments.filter((row) => row.status === 'paid')) {
      const request = dataset.requests.find((row) => row.id === prepayment.requestId);
      const order = dataset.orders.find((row) => row.requestId === request?.id);
      const fact = confirmedFacts.find(
        (row) =>
          row.orderId === order?.id &&
          row.direction === 'inbound' &&
          row.kind === 'prepayment' &&
          row.amountKzt === prepayment.amountKzt,
      );
      expect(fact, `предоплата ${prepayment.id} подтверждена банковским фактом`).toBeDefined();
    }

    for (const payout of dataset.supplierPayouts.filter((row) => row.status === 'paid')) {
      const fact = confirmedFacts.find(
        (row) =>
          row.orderId === payout.orderId &&
          row.supplierCompanyId === payout.supplierCompanyId &&
          row.direction === 'outbound' &&
          row.kind === 'supplier_payout' &&
          row.amountKzt === payout.amountKzt,
      );
      expect(fact, `выплата ${payout.id} подтверждена банковским фактом`).toBeDefined();
    }

    for (const order of dataset.orders.filter((row) => row.state === 'closed')) {
      const plan = dataset.plans.find((row) => row.id === order.approvedPlanId);
      expect(plan, `закрытый заказ ${order.id} имеет утверждённый план`).toBeDefined();
      if (!plan) continue;

      const netReceived = confirmedFacts
        // Расчёт закрытия делается до самого settlement-платежа. Исключаем
        // его факт из базы, иначе возврат/доплата посчитались бы второй раз.
        .filter((fact) => fact.orderId === order.id && fact.kind === 'prepayment')
        .reduce(
          (sum, fact) => sum + (fact.direction === 'inbound' ? fact.amountKzt : -fact.amountKzt),
          0,
        );
      const settlement = calculateSettlement(plan.totalKzt, netReceived);
      expect(order.finalCostKzt).toBe(plan.totalKzt);
      expect(order.settlement).toBe(settlement.kind);
      expect(order.settlementAmountKzt).toBe(
        settlement.kind === 'refund' ? -settlement.amountKzt : settlement.amountKzt,
      );
    }
  });

  it('у демо-заказа дедлайн шире реальных сроков в КП — иначе сравнивать нечего', () => {
    const dataset = generateSeedDataset(PARAMS);
    const order = dataset.orders.find((o) => o.state === 'quotes_received');
    const request = dataset.requests.find((r) => r.id === order?.requestId);
    expect(request?.deadlineDate).toBeDefined();

    const rfqIds = new Set(
      dataset.rfqs.filter((r) => r.requestId === request?.id).map((r) => r.id as string),
    );
    const quoteIds = new Set(
      dataset.quotes.filter((q) => rfqIds.has(q.rfqId as string)).map((q) => q.id as string),
    );
    const leadDays = dataset.quoteLines
      .filter((l) => quoteIds.has(l.quoteId as string))
      .map((l) => l.leadTimeDays as number);

    // Один намеренный выброс (§13, сцена 4) обязан НЕ проходить по сроку.
    const outlier = Math.max(...leadDays);
    expect(outlier).toBeGreaterThan(30);

    const realistic = leadDays.filter((d) => d < 30);
    const daysUntilDeadline = Math.round(
      (new Date(`${request?.deadlineDate}T00:00:00.000Z`).getTime() -
        new Date(PARAMS.referenceDateIso).getTime()) /
        86_400_000,
    );
    // Самый долгий реальный срок плюс межгородний буфер логистики обязан
    // помещаться в дедлайн: без этого combine() бракует все предложения и
    // главный экран продукта показывает «ни один вариант не прошёл».
    expect(daysUntilDeadline).toBeGreaterThan(Math.max(...realistic) + 3);
    expect(daysUntilDeadline).toBeLessThan(outlier);
  });
});
