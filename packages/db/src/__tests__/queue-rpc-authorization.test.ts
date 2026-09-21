import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

/**
 * Служебные RPC очередей: claim/complete/fail для outbox и learning_events и
 * refresh_supplier_stats. Их должен вызывать только worker под service_role.
 *
 * Защита двойная, и тест проверяет каждый слой отдельно:
 *   1. грант: anon и authenticated не имеют EXECUTE вообще;
 *   2. проверка внутри тела: current_setting('role') должен быть service_role.
 *      Второй слой виден только роли, у которой EXECUTE есть, но которая не
 *      service_role, — это владелец функции (сессия суперпользователя).
 *
 * Плюс рабочий цикл под service_role: аренда, чужая аренда не завершает работу,
 * сбой откладывает повтор, просроченная аренда забирается заново.
 * Каждый случай — в транзакции с откатом.
 */

const databaseUrl = process.env.DATABASE_URL;
const describeIfConfigured = databaseUrl ? describe : describe.skip;
const rollback = new Error('fixture rollback');
type Tx = postgres.TransactionSql;

async function scenario(run: (tx: Tx) => Promise<void>) {
  const sql = postgres(databaseUrl as string, { max: 1, prepare: false });
  try {
    await sql
      .begin(async (tx) => {
        await run(tx);
        throw rollback;
      })
      .catch((error) => {
        if (error !== rollback) throw error;
      });
  } finally {
    await sql.end();
  }
}

const asRole = async (tx: Tx, role: 'anon' | 'authenticated' | 'service_role') => {
  await tx`reset role`;
  await tx.unsafe(`set local role ${role}`);
};
const asOwner = async (tx: Tx) => {
  await tx`reset role`;
};

async function expectRejected(tx: Tx, reason: RegExp, call: () => Promise<unknown>) {
  await expect(tx.savepoint(call)).rejects.toThrow(reason);
}

const uuid = () => crypto.randomUUID();
const LEASE = 'lease-under-test';

interface QueueFn {
  name: string;
  /** Вызов с заведомо правдоподобными аргументами. */
  call: (tx: Tx) => Promise<unknown>;
  bodyMessage: RegExp;
}

const QUEUE_FUNCTIONS: QueueFn[] = [
  {
    name: 'claim_outbox_batch',
    call: (tx) => tx`select * from public.claim_outbox_batch(5, ${LEASE})`,
    bodyMessage: /Только worker service_role может забирать outbox/,
  },
  {
    name: 'complete_outbox',
    call: (tx) => tx`select public.complete_outbox(${uuid()}, ${LEASE}, 'x')`,
    bodyMessage: /Только worker service_role может завершить outbox/,
  },
  {
    name: 'fail_outbox',
    call: (tx) => tx`select public.fail_outbox(${uuid()}, ${LEASE}, 'boom')`,
    bodyMessage: /Только worker service_role может вернуть outbox в retry/,
  },
  {
    name: 'claim_learning_events',
    call: (tx) => tx`select * from public.claim_learning_events(5, ${LEASE})`,
    bodyMessage: /Только worker service_role может забирать learning events/,
  },
  {
    name: 'complete_learning_event',
    call: (tx) => tx`select public.complete_learning_event(${uuid()}, ${LEASE})`,
    bodyMessage: /Только worker service_role может завершить learning event/,
  },
  {
    name: 'fail_learning_event',
    call: (tx) => tx`select public.fail_learning_event(${uuid()}, ${LEASE}, 'boom')`,
    bodyMessage: /Только worker service_role может вернуть learning event в retry/,
  },
];

describeIfConfigured('служебные RPC очередей: только worker под service_role', () => {
  describe.each(QUEUE_FUNCTIONS)('$name', (fn) => {
    it('anon и authenticated не имеют права вызвать функцию (слой 1: грант)', async () => {
      for (const role of ['anon', 'authenticated'] as const) {
        await scenario(async (tx) => {
          await asRole(tx, role);
          await expectRejected(tx, /permission denied for function/, () => fn.call(tx));
        });
      }
    });

    it('роль без service_role, даже имея EXECUTE, отклоняется телом функции (слой 2)', async () => {
      await scenario(async (tx) => {
        await asOwner(tx);
        await expectRejected(tx, fn.bodyMessage, () => fn.call(tx));
      });
    });

    it('service_role функцию исполнять может', async () => {
      await scenario(async (tx) => {
        await asRole(tx, 'service_role');
        await expect(tx.savepoint(() => fn.call(tx))).resolves.toBeDefined();
      });
    });
  });

  describe('refresh_supplier_stats', () => {
    it('anon и authenticated не имеют права вызвать функцию', async () => {
      for (const role of ['anon', 'authenticated'] as const) {
        await scenario(async (tx) => {
          await asRole(tx, role);
          await expectRejected(
            tx,
            /permission denied for function/,
            () => tx`select public.refresh_supplier_stats(${uuid()})`,
          );
        });
      }
    });
  });

  describe('outbox: рабочий цикл под service_role', () => {
    async function seed(tx: Tx, n = 1) {
      await asOwner(tx);
      const ids: string[] = [];
      for (let i = 0; i < n; i += 1) {
        const [row] = await tx`insert into outbox (kind, recipient, subject, body)
          values ('test', ${`q${i}-${uuid()}@example.test`}, 's', 'b') returning id`;
        ids.push(row?.id as string);
      }
      return ids;
    }

    async function state(tx: Tx, id: string) {
      await asOwner(tx);
      const [row] = await tx`select status, attempts, lease_id, provider_message_id,
        available_at > now() as deferred from outbox where id = ${id}`;
      return row;
    }

    it('claim выдаёт строку в аренду и считает попытку; complete по своей аренде закрывает её', async () => {
      await scenario(async (tx) => {
        const [id] = await seed(tx);
        await asRole(tx, 'service_role');
        const claimed = await tx`select id from public.claim_outbox_batch(100, ${LEASE})`;
        expect(claimed.map((r) => r.id)).toContain(id);

        expect(await state(tx, id as string)).toMatchObject({
          status: 'processing',
          attempts: 1,
          lease_id: LEASE,
        });

        await asRole(tx, 'service_role');
        const [done] =
          await tx`select public.complete_outbox(${id as string}, ${LEASE}, 'prov-1') as ok`;
        expect(done?.ok).toBe(true);
        expect(await state(tx, id as string)).toMatchObject({
          status: 'sent',
          lease_id: null,
          provider_message_id: 'prov-1',
        });
      });
    });

    it('чужая аренда не завершает и не проваливает работу', async () => {
      await scenario(async (tx) => {
        const [id] = await seed(tx);
        await asRole(tx, 'service_role');
        await tx`select id from public.claim_outbox_batch(100, ${LEASE})`;
        const [c] =
          await tx`select public.complete_outbox(${id as string}, 'someone-else', 'x') as ok`;
        const [f] = await tx`select public.fail_outbox(${id as string}, 'someone-else', 'x') as ok`;
        expect(c?.ok).toBe(false);
        expect(f?.ok).toBe(false);
        expect(await state(tx, id as string)).toMatchObject({
          status: 'processing',
          lease_id: LEASE,
        });
      });
    });

    it('fail откладывает повтор, и отложенная строка не забирается снова сразу', async () => {
      await scenario(async (tx) => {
        const [id] = await seed(tx);
        await asRole(tx, 'service_role');
        await tx`select id from public.claim_outbox_batch(100, ${LEASE})`;
        const [f] =
          await tx`select public.fail_outbox(${id as string}, ${LEASE}, 'provider down') as ok`;
        expect(f?.ok).toBe(true);
        expect(await state(tx, id as string)).toMatchObject({ status: 'failed', deferred: true });

        await asRole(tx, 'service_role');
        const again = await tx`select id from public.claim_outbox_batch(100, 'second')`;
        expect(again.map((r) => r.id)).not.toContain(id);
      });
    });

    it('просроченная аренда забирается заново, а завершённая строка — никогда', async () => {
      await scenario(async (tx) => {
        const [expired, sent] = await seed(tx, 2);
        await asOwner(tx);
        await tx`update outbox set status = 'processing', lease_id = 'dead', leased_until = now() - interval '1 minute'
          where id = ${expired as string}`;
        await tx`update outbox set status = 'sent' where id = ${sent as string}`;

        await asRole(tx, 'service_role');
        const claimed = (await tx`select id from public.claim_outbox_batch(100, ${LEASE})`).map(
          (r) => r.id,
        );
        expect(claimed).toContain(expired);
        expect(claimed).not.toContain(sent);
      });
    });
  });

  describe('learning_events: рабочий цикл под service_role', () => {
    async function seed(tx: Tx) {
      await asOwner(tx);
      const [row] =
        await tx`insert into learning_events (type, payload) values ('test', '{}'::jsonb) returning id`;
      return row?.id as string;
    }

    async function state(tx: Tx, id: string) {
      await asOwner(tx);
      const [row] = await tx`select processed_at is not null as processed, attempts, lease_id,
        available_at > now() as deferred from learning_events where id = ${id}`;
      return row;
    }

    it('claim, затем complete по своей аренде', async () => {
      await scenario(async (tx) => {
        const id = await seed(tx);
        await asRole(tx, 'service_role');
        const claimed = await tx`select id from public.claim_learning_events(100, ${LEASE})`;
        expect(claimed.map((r) => r.id)).toContain(id);
        expect(await state(tx, id)).toMatchObject({
          processed: false,
          attempts: 1,
          lease_id: LEASE,
        });

        await asRole(tx, 'service_role');
        const [done] = await tx`select public.complete_learning_event(${id}, ${LEASE}) as ok`;
        expect(done?.ok).toBe(true);
        expect(await state(tx, id)).toMatchObject({ processed: true, lease_id: null });
      });
    });

    it('чужая аренда не завершает и не проваливает событие', async () => {
      await scenario(async (tx) => {
        const id = await seed(tx);
        await asRole(tx, 'service_role');
        await tx`select id from public.claim_learning_events(100, ${LEASE})`;
        const [c] = await tx`select public.complete_learning_event(${id}, 'someone-else') as ok`;
        const [f] = await tx`select public.fail_learning_event(${id}, 'someone-else', 'x') as ok`;
        expect(c?.ok).toBe(false);
        expect(f?.ok).toBe(false);
        expect(await state(tx, id)).toMatchObject({ processed: false, lease_id: LEASE });
      });
    });

    it('fail откладывает повтор и не даёт забрать событие сразу же', async () => {
      await scenario(async (tx) => {
        const id = await seed(tx);
        await asRole(tx, 'service_role');
        await tx`select id from public.claim_learning_events(100, ${LEASE})`;
        const [f] = await tx`select public.fail_learning_event(${id}, ${LEASE}, 'boom') as ok`;
        expect(f?.ok).toBe(true);
        expect(await state(tx, id)).toMatchObject({
          processed: false,
          deferred: true,
          lease_id: null,
        });

        await asRole(tx, 'service_role');
        const again = await tx`select id from public.claim_learning_events(100, 'second')`;
        expect(again.map((r) => r.id)).not.toContain(id);
      });
    });
  });
});
