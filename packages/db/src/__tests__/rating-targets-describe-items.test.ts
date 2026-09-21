import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

/**
 * Покупателю показывают «Исполнитель 1» и просят поставить балл, не говоря, за
 * что. Личности поставщиков скрыты намеренно (QAJET — подрядчик покупателя и
 * рассчитывается с поставщиками сам), поэтому назвать нужно не КОГО, а ЧТО:
 * какие позиции заявки этот исполнитель вёз.
 *
 * Строки плана покупателю недоступны — политики `plan_lines` открыты только
 * персоналу и самому поставщику. Поэтому состав отдаёт та же SECURITY DEFINER
 * функция, что уже проверяет права покупателя внутри тела.
 *
 * Здесь же закреплено то, что показывать НЕЛЬЗЯ: ни названия компании
 * поставщика, ни его цен.
 */

const databaseUrl = process.env.DATABASE_URL;
const describeIfConfigured = databaseUrl ? describe : describe.skip;
const rollback = new Error('fixture rollback');

interface World {
  buyer: string;
  outsider: string;
  order: string;
  supplierA: string;
  supplierB: string;
  supplierAName: string;
}

async function scenario(run: (tx: postgres.TransactionSql, w: World) => Promise<void>) {
  const sql = postgres(databaseUrl as string, { max: 1, prepare: false });
  const id = () => crypto.randomUUID();
  try {
    await sql
      .begin(async (tx) => {
        const buyerCo = id();
        const otherBuyerCo = id();
        const supplierACo = id();
        const supplierBCo = id();
        const w: World = {
          buyer: id(),
          outsider: id(),
          order: id(),
          supplierA: supplierACo,
          supplierB: supplierBCo,
          supplierAName: 'ООО Секретный Поставщик',
        };
        const request = id();
        const plan = id();
        const itemPens = id();
        const itemMugs = id();

        await tx`insert into companies (id, type, name) values
          (${buyerCo}, 'buyer', 'E2E-rating buyer'),
          (${otherBuyerCo}, 'buyer', 'E2E-rating other'),
          (${supplierACo}, 'supplier', ${w.supplierAName}),
          (${supplierBCo}, 'supplier', 'ООО Второй Поставщик')`;
        await tx`insert into auth.users (id) values (${w.buyer}), (${w.outsider})`;
        await tx`insert into public.users (id, company_id, role, full_name, email) values
          (${w.buyer}, ${buyerCo}, 'owner', 'Buyer', ${`${w.buyer}@example.test`}),
          (${w.outsider}, ${otherBuyerCo}, 'owner', 'Outsider', ${`${w.outsider}@example.test`})`;
        await tx`insert into requests (id, buyer_company_id, created_by, title, raw_text)
          values (${request}, ${buyerCo}, ${w.buyer}, 'E2E-rating', 'E2E-rating')`;
        await tx`insert into request_items (id, request_id, name, category, qty, unit) values
          (${itemPens}, ${request}, 'Ручки с логотипом', 'merch', 500, 'шт'),
          (${itemMugs}, ${request}, 'Кружки керамические', 'merch', 200, 'шт')`;
        await tx`insert into plans (id, request_id, kind, total_supplier_kzt, delivery_kzt,
          commission_kzt, commission_base, total_kzt, supplier_count, explanation, status)
          values (${plan}, ${request}, 'recommended', 100000, 0, 23000, 'supplier_ex_delivery', 123000, 2, '{}', 'approved')`;

        const addLine = async (itemId: string, supplierCo: string) => {
          const rfq = id();
          const quote = id();
          const quoteLine = id();
          await tx`insert into rfqs (id, request_id, supplier_company_id, token)
            values (${rfq}, ${request}, ${supplierCo}, ${id()})`;
          await tx`insert into quotes (id, rfq_id) values (${quote}, ${rfq})`;
          await tx`insert into quote_lines (id, quote_id, request_item_id, unit_price_kzt, lead_time_days)
            values (${quoteLine}, ${quote}, ${itemId}, 100, 2)`;
          await tx`insert into plan_lines (plan_id, request_item_id, supplier_company_id, quote_line_id,
            qty, line_total_kzt, commission_pct, commission_kzt)
            values (${plan}, ${itemId}, ${supplierCo}, ${quoteLine}, 10, 50000, 23, 11500)`;
        };
        await addLine(itemPens, supplierACo);
        await addLine(itemMugs, supplierBCo);

        await tx`insert into orders (id, request_id, approved_plan_id, state)
          values (${w.order}, ${request}, ${plan}, 'closed')`;

        await run(tx, w);
        throw rollback;
      })
      .catch((error) => {
        if (error !== rollback) throw error;
      });
  } finally {
    await sql.end();
  }
}

async function asUser(tx: postgres.TransactionSql, userId: string) {
  await tx`reset role`;
  await tx`set local role authenticated`;
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`;
}

describeIfConfigured('get_buyer_rating_targets: покупатель видит, что оценивает', () => {
  it('каждый исполнитель назван теми позициями, которые он вёз', async () => {
    await scenario(async (tx, w) => {
      await asUser(tx, w.buyer);
      const rows = await tx`select * from public.get_buyer_rating_targets(${w.order})`;

      expect(rows, 'два исполнителя в утверждённом плане').toHaveLength(2);

      const byCompany = new Map(rows.map((row) => [row.supplier_company_id as string, row]));
      expect(byCompany.get(w.supplierA)?.item_names).toEqual(['Ручки с логотипом']);
      expect(byCompany.get(w.supplierB)?.item_names).toEqual(['Кружки керамические']);
    });
  });

  it('состав не раскрывает ни названия компании поставщика, ни его цен', async () => {
    await scenario(async (tx, w) => {
      await asUser(tx, w.buyer);
      const rows = await tx`select * from public.get_buyer_rating_targets(${w.order})`;

      const asText = JSON.stringify(rows);
      expect(asText, 'название компании поставщика — не для покупателя').not.toContain(
        w.supplierAName,
      );
      // Сумма строки плана (50000) и комиссия (11500) тоже не должны просочиться.
      expect(asText).not.toContain('50000');
      expect(asText).not.toContain('11500');
    });
  });

  it('несколько позиций одного исполнителя перечислены и упорядочены', async () => {
    await scenario(async (tx, w) => {
      // Переносим вторую позицию на того же исполнителя: он вёз обе.
      await tx`update plan_lines set supplier_company_id = ${w.supplierA}
        where supplier_company_id = ${w.supplierB}`;
      await asUser(tx, w.buyer);
      const rows = await tx`select * from public.get_buyer_rating_targets(${w.order})`;

      expect(rows).toHaveLength(1);
      expect(rows[0]?.item_names).toEqual(['Кружки керамические', 'Ручки с логотипом']);
    });
  });

  it('чужой покупатель по-прежнему не получает ничего', async () => {
    await scenario(async (tx, w) => {
      await asUser(tx, w.outsider);
      await expect(tx`select * from public.get_buyer_rating_targets(${w.order})`).rejects.toThrow(
        /только по закрытому заказу своей компании/i,
      );
    });
  });
});
