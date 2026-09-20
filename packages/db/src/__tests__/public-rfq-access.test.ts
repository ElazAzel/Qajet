import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

/**
 * Публичные RFQ-функции — единственная поверхность, доступная без входа.
 *
 * function-privileges.test.ts проверяет только то, что anon МОЖЕТ их вызвать.
 * Здесь проверено главное: что именно эта возможность не даёт лишнего. Ссылка
 * авторизует ровно одну строку rfqs, и только пока она действительна:
 *   - неверный токен, токен чужого RFQ, просроченный срок, отключённый поставщик;
 *   - терминальные статусы (повтор и «воскрешение» закрытого RFQ);
 *   - позиция из чужой заявки и другие дефекты строк КП.
 *
 * Каждый случай выполняется в транзакции с откатом и не оставляет следов.
 */

const databaseUrl = process.env.DATABASE_URL;
const describeIfConfigured = databaseUrl ? describe : describe.skip;
const rollback = new Error('fixture rollback');

interface Fixture {
  rfq: string;
  token: string;
  otherRfq: string;
  otherToken: string;
  item: string;
  foreignItem: string;
  supplier: string;
}

interface Options {
  respondBy?: string | null;
  supplierActive?: boolean;
  status?: string;
}

async function scenario(
  options: Options,
  run: (tx: postgres.TransactionSql, f: Fixture) => Promise<void>,
) {
  const sql = postgres(databaseUrl as string, { max: 1, prepare: false });
  try {
    await sql
      .begin(async (tx) => {
        const f: Fixture = {
          rfq: crypto.randomUUID(),
          token: crypto.randomUUID(),
          otherRfq: crypto.randomUUID(),
          otherToken: crypto.randomUUID(),
          item: crypto.randomUUID(),
          foreignItem: crypto.randomUUID(),
          supplier: crypto.randomUUID(),
        };
        const buyer = crypto.randomUUID();
        const otherSupplier = crypto.randomUUID();
        const user = crypto.randomUUID();
        const request = crypto.randomUUID();
        const otherRequest = crypto.randomUUID();

        await tx`insert into companies (id, type, name, is_active) values
          (${buyer}, 'buyer', 'RFQ buyer', true),
          (${f.supplier}, 'supplier', 'RFQ supplier', ${options.supplierActive ?? true}),
          (${otherSupplier}, 'supplier', 'RFQ other supplier', true)`;
        await tx`insert into auth.users (id) values (${user})`;
        await tx`insert into public.users (id, company_id, role, full_name, email)
          values (${user}, ${buyer}, 'owner', 'Buyer', 'rfq-buyer@example.com')`;
        await tx`insert into requests (id, buyer_company_id, created_by, title, raw_text) values
          (${request}, ${buyer}, ${user}, 'RFQ', 'RFQ'),
          (${otherRequest}, ${buyer}, ${user}, 'Other', 'Other')`;
        await tx`insert into request_items (id, request_id, name, category, qty, unit) values
          (${f.item}, ${request}, 'Item', 'merch', 10, 'шт'),
          (${f.foreignItem}, ${otherRequest}, 'Foreign', 'merch', 10, 'шт')`;
        await tx`insert into rfqs (id, request_id, supplier_company_id, token, status, respond_by) values
          (${f.rfq}, ${request}, ${f.supplier}, ${f.token}, ${options.status ?? 'sent'}, ${options.respondBy ?? null}),
          (${f.otherRfq}, ${otherRequest}, ${otherSupplier}, ${f.otherToken}, 'sent', null)`;

        await tx`set local role anon`;
        await run(tx, f);
        throw rollback;
      })
      .catch((error) => {
        if (error !== rollback) throw error;
      });
  } finally {
    await sql.end();
  }
}

/** Вызов должен быть отклонён; savepoint оставляет транзакцию пригодной для проверок. */
async function expectRejected(
  tx: postgres.TransactionSql,
  call: () => Promise<unknown>,
  reason: RegExp = LINK_INVALID,
) {
  // Причина проверяется: иначе тест «отклоняет X» проходит и тогда, когда
  // вызов отклонён по совсем другой причине, а проверка X не работает.
  await expect(tx.savepoint(call)).rejects.toThrow(reason);
}

const LINK_INVALID = /Ссылка RFQ недействительна/;

const validLine = (f: Fixture, over: Record<string, unknown> = {}) => ({
  requestItemId: f.item,
  unitPriceKzt: 1000,
  leadTimeDays: 5,
  ...over,
});

async function statusOf(tx: postgres.TransactionSql, rfq: string): Promise<string> {
  await tx`reset role`;
  const [row] = await tx`select status from rfqs where id = ${rfq}`;
  await tx`set local role anon`;
  return row?.status as string;
}

describeIfConfigured('публичные RFQ-функции: ссылка авторизует ровно один RFQ', () => {
  describe('get_rfq_quick_response', () => {
    it('с верным токеном отдаёт позиции своего RFQ и ничего чужого', async () => {
      await scenario({}, async (tx, f) => {
        const [{ r }] = await tx`select public.get_rfq_quick_response(${f.rfq}, ${f.token}) as r`;
        expect(r.rfqId).toBe(f.rfq);
        expect(r.items.map((i: { id: string }) => i.id)).toEqual([f.item]);
      });
    });

    it('отклоняет неверный токен', async () => {
      await scenario({}, async (tx, f) => {
        await expectRejected(
          tx,
          () => tx`select public.get_rfq_quick_response(${f.rfq}, ${crypto.randomUUID()})`,
        );
      });
    });

    it('отклоняет токен другого RFQ при верном id', async () => {
      await scenario({}, async (tx, f) => {
        await expectRejected(
          tx,
          () => tx`select public.get_rfq_quick_response(${f.rfq}, ${f.otherToken})`,
        );
      });
    });

    it('отклоняет просроченную ссылку', async () => {
      await scenario({ respondBy: '2020-01-01T00:00:00Z' }, async (tx, f) => {
        await expectRejected(
          tx,
          () => tx`select public.get_rfq_quick_response(${f.rfq}, ${f.token})`,
        );
      });
    });

    it('отклоняет ссылку отключённого поставщика', async () => {
      await scenario({ supplierActive: false }, async (tx, f) => {
        await expectRejected(
          tx,
          () => tx`select public.get_rfq_quick_response(${f.rfq}, ${f.token})`,
        );
      });
    });

    it('не раскрывает RFQ в статусе, которого у публичной ссылки быть не может', async () => {
      await scenario({ status: 'expired' }, async (tx, f) => {
        await expectRejected(
          tx,
          () => tx`select public.get_rfq_quick_response(${f.rfq}, ${f.token})`,
        );
      });
    });
  });

  describe('quick_respond_rfq_public и decline_rfq_public', () => {
    it('с верным токеном меняют статус ровно своего RFQ', async () => {
      await scenario({}, async (tx, f) => {
        await tx`select public.quick_respond_rfq_public(${f.rfq}, ${f.token})`;
        expect(await statusOf(tx, f.rfq)).toBe('quick_responded');
        await tx`select public.decline_rfq_public(${f.rfq}, ${f.token})`;
        expect(await statusOf(tx, f.rfq)).toBe('declined');
        expect(await statusOf(tx, f.otherRfq)).toBe('sent');
      });
    });

    it.each([['quick_respond_rfq_public'], ['decline_rfq_public']])(
      '%s отклоняет неверный токен и токен чужого RFQ, статус не меняется',
      async (fn) => {
        await scenario({}, async (tx, f) => {
          await expectRejected(tx, () => tx`select public.${tx(fn)}(${f.rfq}, ${'wrong-token'})`);
          await expectRejected(tx, () => tx`select public.${tx(fn)}(${f.rfq}, ${f.otherToken})`);
          expect(await statusOf(tx, f.rfq)).toBe('sent');
        });
      },
    );

    it.each([['quick_respond_rfq_public'], ['decline_rfq_public']])(
      '%s отклоняет просроченную ссылку и отключённого поставщика',
      async (fn) => {
        await scenario({ respondBy: '2020-01-01T00:00:00Z' }, async (tx, f) => {
          await expectRejected(tx, () => tx`select public.${tx(fn)}(${f.rfq}, ${f.token})`);
          expect(await statusOf(tx, f.rfq)).toBe('sent');
        });
        await scenario({ supplierActive: false }, async (tx, f) => {
          await expectRejected(tx, () => tx`select public.${tx(fn)}(${f.rfq}, ${f.token})`);
          expect(await statusOf(tx, f.rfq)).toBe('sent');
        });
      },
    );

    it.each([['quick_respond_rfq_public'], ['decline_rfq_public']])(
      '%s не «воскрешает» закрытые RFQ',
      async (fn) => {
        for (const status of ['declined', 'quoted', 'expired']) {
          await scenario({ status }, async (tx, f) => {
            await expectRejected(tx, () => tx`select public.${tx(fn)}(${f.rfq}, ${f.token})`);
            expect(await statusOf(tx, f.rfq)).toBe(status);
          });
        }
      },
    );
  });

  describe('submit_rfq_public', () => {
    it('с верным токеном создаёт КП только по своей заявке и закрывает RFQ', async () => {
      await scenario({}, async (tx, f) => {
        const lines = JSON.stringify([validLine(f)]);
        const [{ id }] =
          await tx`select public.submit_rfq_public(${f.rfq}, ${f.token}, ${lines}::text::jsonb) as id`;
        expect(id).toBeTruthy();
        expect(await statusOf(tx, f.rfq)).toBe('quoted');
        await tx`reset role`;
        const stored = await tx`select rfq_id, request_item_id from quotes q
          join quote_lines l on l.quote_id = q.id where q.id = ${id}`;
        expect(stored).toHaveLength(1);
        expect(stored[0]?.rfq_id).toBe(f.rfq);
        expect(stored[0]?.request_item_id).toBe(f.item);
      });
    });

    it('повторная отправка по той же ссылке отклоняется и не создаёт второе КП', async () => {
      await scenario({}, async (tx, f) => {
        const lines = JSON.stringify([validLine(f)]);
        await tx`select public.submit_rfq_public(${f.rfq}, ${f.token}, ${lines}::text::jsonb)`;
        await expectRejected(
          tx,
          () => tx`select public.submit_rfq_public(${f.rfq}, ${f.token}, ${lines}::text::jsonb)`,
        );
        await tx`reset role`;
        const [{ n }] = await tx`select count(*)::int as n from quotes where rfq_id = ${f.rfq}`;
        expect(n).toBe(1);
      });
    });

    it('отклоняет неверный токен, чужой токен, просрочку и отключённого поставщика', async () => {
      const lines = (f: Fixture) => JSON.stringify([validLine(f)]);
      await scenario({}, async (tx, f) => {
        await expectRejected(
          tx,
          () => tx`select public.submit_rfq_public(${f.rfq}, ${'wrong'}, ${lines(f)}::text::jsonb)`,
        );
        await expectRejected(
          tx,
          () =>
            tx`select public.submit_rfq_public(${f.rfq}, ${f.otherToken}, ${lines(f)}::text::jsonb)`,
        );
        await tx`reset role`;
        const [{ n }] = await tx`select count(*)::int as n from quotes where rfq_id = ${f.rfq}`;
        expect(n).toBe(0);
      });
      await scenario({ respondBy: '2020-01-01T00:00:00Z' }, async (tx, f) => {
        await expectRejected(
          tx,
          () => tx`select public.submit_rfq_public(${f.rfq}, ${f.token}, ${lines(f)}::text::jsonb)`,
        );
      });
      await scenario({ supplierActive: false }, async (tx, f) => {
        await expectRejected(
          tx,
          () => tx`select public.submit_rfq_public(${f.rfq}, ${f.token}, ${lines(f)}::text::jsonb)`,
        );
      });
    });

    it.each([
      ['пустой массив', () => [], /хотя бы одну позицию/],
      ['не массив', () => ({ requestItemId: 'x' }), /хотя бы одну позицию/],
      ['нулевая цена', (f: Fixture) => [validLine(f, { unitPriceKzt: 0 })], /больше нуля/],
      [
        'отрицательный срок',
        (f: Fixture) => [validLine(f, { leadTimeDays: -1 })],
        /целыми неотрицательными/,
      ],
      [
        'дробная цена',
        (f: Fixture) => [validLine(f, { unitPriceKzt: 10.5 })],
        /целыми неотрицательными/,
      ],
      [
        'цена строкой',
        (f: Fixture) => [validLine(f, { unitPriceKzt: '1000' })],
        /должны быть числами/,
      ],
      [
        'без позиции заявки',
        (f: Fixture) => [validLine(f, { requestItemId: null })],
        /Укажите позицию заявки/,
      ],
      [
        'дубль позиции',
        (f: Fixture) => [validLine(f), validLine(f, { unitPriceKzt: 2000 })],
        /только один раз/,
      ],
      [
        'позиция из чужой заявки',
        (f: Fixture) => [validLine(f, { requestItemId: f.foreignItem })],
        /не принадлежит этой заявке/,
      ],
    ])(
      'отклоняет некорректные строки КП: %s — по своей причине и без частичного КП',
      async (_name, build, reason) => {
        await scenario({}, async (tx, f) => {
          const lines = JSON.stringify(build(f));
          await expectRejected(
            tx,
            () => tx`select public.submit_rfq_public(${f.rfq}, ${f.token}, ${lines}::text::jsonb)`,
            reason,
          );
          await tx`reset role`;
          const [{ n }] = await tx`select count(*)::int as n from quotes where rfq_id = ${f.rfq}`;
          expect(n).toBe(0);
          expect(await statusOf(tx, f.rfq)).toBe('sent');
        });
      },
    );
  });

  describe('прямой доступ к таблицам без функции', () => {
    it('anon не читает токены и не может править RFQ напрямую', async () => {
      await scenario({}, async (tx, f) => {
        // Либо нет привилегии, либо RLS отдаёт ноль строк — не должно быть ни токена, ни строки.
        const read = await tx
          .savepoint(async (sp) => sp`select token from rfqs where id = ${f.rfq}`)
          .catch(() => []);
        expect(read).toHaveLength(0);

        await tx
          .savepoint(async (sp) => sp`update rfqs set status = 'quoted' where id = ${f.rfq}`)
          .catch(() => undefined);
        expect(await statusOf(tx, f.rfq)).toBe('sent');
      });
    });
  });
});
