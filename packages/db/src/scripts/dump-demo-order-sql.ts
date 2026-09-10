import * as schema from '../schema/index.js';
import { DEMO_ORDER_REQUEST_TITLE, generateSeedDataset } from '../seed/generator.js';
import { insertStatements, quote } from './_sql-literal.js';

/**
 * `pnpm db:demo-order` — восстановить ТОЛЬКО демо-заказ на стадии
 * `quotes_received` (agents.md §13: 6 позиций, 5 КП, 2 с пропусками, один с
 * невыполнимым сроком), не трогая остальную историю.
 *
 * Зачем отдельно от `db:reset`: этот заказ расходуется каждым прогоном демо
 * и каждой сквозной проверкой — его двигают до `closed`, и вокруг него
 * пустеет главный экран продукта (сравнение вариантов) и пять из восьми
 * сцен `/demo`. Журналы дважды помечали это открытым риском, и он дважды
 * реализовался. Полный `db:reset` ради одного заказа снёс бы девять
 * месяцев истории, на которой учатся модели.
 *
 * Вывод — текст SQL, а не прямая вставка: у боевой базы этого проекта нет
 * доступного `DATABASE_URL`, она с самого начала наполняется через
 * MCP-коннектор Supabase.
 *
 * Поставщики сопоставляются по НАЗВАНИЮ компании: сгенерированные компании
 * носят те же имена, что и живые (`PrintCraft KZ`, `MerchLine Almaty`…),
 * поэтому сопоставление устойчиво к разным id в базе и к порядку выборки.
 *
 *   pnpm db:demo-order --buyer-company=<uuid> --concierge=<uuid> --buyer=<uuid> \
 *     --supplier="PrintCraft KZ:<uuid>" --supplier="MerchLine Almaty:<uuid>" …
 */

interface Args {
  buyerCompanyId: string;
  conciergeUserId: string;
  buyerUserId: string;
  suppliersByName: Map<string, string>;
}

function parseArgs(): Args {
  let buyerCompanyId = '';
  let conciergeUserId = '';
  let buyerUserId = '';
  const suppliersByName = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const eq = arg.indexOf('=');
    const flag = arg.slice(0, eq);
    const value = arg.slice(eq + 1);
    if (flag === '--buyer-company') buyerCompanyId = value;
    else if (flag === '--concierge') conciergeUserId = value;
    else if (flag === '--buyer') buyerUserId = value;
    else if (flag === '--supplier') {
      const sep = value.lastIndexOf(':');
      suppliersByName.set(value.slice(0, sep), value.slice(sep + 1));
    }
  }
  if (!buyerCompanyId || !conciergeUserId || !buyerUserId) {
    throw new Error('нужны --buyer-company, --concierge и --buyer');
  }
  return { buyerCompanyId, conciergeUserId, buyerUserId, suppliersByName };
}

function main(): void {
  const args = parseArgs();
  const dataset = generateSeedDataset({
    seed: 1,
    referenceDateIso: new Date().toISOString().slice(0, 10),
    existing: {
      buyerCompanyId: args.buyerCompanyId,
      accountsByEmail: {
        'concierge@demo.qajet.kz': args.conciergeUserId,
        'buyer@demo.qajet.kz': args.buyerUserId,
      },
    },
  });

  const order = dataset.orders.find((o) => o.state === 'quotes_received');
  if (!order) throw new Error('в сгенерированном наборе нет заказа на стадии quotes_received');
  const orderId = order.id as string;
  const requestId = order.requestId as string;

  // Сгенерированный companyId → живой, по названию компании.
  const liveCompanyId = new Map<string, string>();
  for (const company of dataset.companies) {
    const live = args.suppliersByName.get(company.name as string);
    if (live) liveCompanyId.set(company.id as string, live);
  }
  const remap = <T extends Record<string, unknown>>(row: T, key: keyof T & string): T => {
    const current = row[key];
    if (typeof current !== 'string') return row;
    const live = liveCompanyId.get(current);
    if (!live) throw new Error(`нет живого поставщика для ${String(current)} (${key})`);
    return { ...row, [key]: live };
  };

  const rfqs = dataset.rfqs
    .filter((r) => r.requestId === requestId)
    .map((r) => remap(r, 'supplierCompanyId'));
  const rfqIds = new Set(rfqs.map((r) => r.id as string));
  // У `quotes` своей колонки поставщика нет — личность приходит только через
  // `rfqs.supplier_company_id`, поэтому переназначать здесь нечего.
  const quotes = dataset.quotes.filter((q) => rfqIds.has(q.rfqId as string));
  const quoteIds = new Set(quotes.map((q) => q.id as string));

  const blocks: [PgTableLike, readonly Record<string, unknown>[]][] = [
    [schema.requests, dataset.requests.filter((r) => r.id === requestId)],
    [schema.requestItems, dataset.requestItems.filter((i) => i.requestId === requestId)],
    [schema.estimates, dataset.estimates.filter((e) => e.requestId === requestId)],
    [schema.plans, dataset.plans.filter((p) => p.requestId === requestId)],
    [schema.orders, [order]],
    [schema.orderStageEvents, dataset.orderStageEvents.filter((e) => e.orderId === orderId)],
    [schema.rfqs, rfqs],
    [schema.quotes, quotes],
    [schema.quoteLines, dataset.quoteLines.filter((l) => quoteIds.has(l.quoteId as string))],
    [schema.timeEntries, dataset.timeEntries.filter((t) => t.orderId === orderId)],
    [schema.threads, dataset.threads.filter((t) => t.orderId === orderId)],
  ];
  const threadIds = new Set(
    dataset.threads.filter((t) => t.orderId === orderId).map((t) => t.id as string),
  );
  blocks.push([
    schema.messages,
    dataset.messages.filter((m) => threadIds.has(m.threadId as string)),
  ]);

  const lines: string[] = [
    '-- Демо-заказ agents.md §13, сгенерирован pnpm db:demo-order.',
    '-- Снимает ПРЕДЫДУЩИЙ демо-заказ, чтобы их не стало два. Условие — по',
    '-- заголовку демо-заявки и компании-покупателю, а не по стадии',
    "-- 'quotes_received': стадия это нормальное рабочее состояние, и на базе",
    '-- с живыми заказами такое удаление снесло бы чужую заявку со всем, что',
    '-- на неё завязано каскадом.',
    `delete from requests where title = ${quote(DEMO_ORDER_REQUEST_TITLE)} and buyer_company_id = ${quote(args.buyerCompanyId)};`,
  ];
  for (const [table, rows] of blocks) lines.push(...insertStatements(table, rows, 10));

  process.stdout.write(`${lines.join('\n')}\n`);
  process.stderr.write(
    `Демо-заказ ${orderId}: ${dataset.requestItems.filter((i) => i.requestId === requestId).length} позиций, ${quotes.length} КП, ${rfqs.length} RFQ.\n`,
  );
  void quote;
}

type PgTableLike = Parameters<typeof insertStatements>[0];

main();
