import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

/**
 * Планировщик фоновых задач живёт в самой базе (pg_cron), а не в GitHub Actions.
 *
 * Зачем перенос. Планировщик в GitHub Actions запускался каждые 15 минут — 96
 * раз в сутки. Каждый запуск длился около 7 секунд, но GitHub округляет каждую
 * задачу вверх до целой минуты. Выходило около 2 880 оплачиваемых минут в месяц
 * при бесплатных 2 000 на приватный репозиторий: планировщик сам по себе
 * гарантированно съедал весь лимит, и CI после этого не запускался вовсе.
 * pg_cron работает внутри базы и поминутно не тарифицируется.
 *
 * Что здесь закреплено:
 *   - задание расписано на каждые 15 минут;
 *   - функцию нельзя вызвать ни анониму, ни вошедшему пользователю — иначе
 *     кто угодно мог бы дёргать фоновые задачи сколько угодно раз;
 *   - пока секрет не положен в Vault, функция не делает НИЧЕГО, а не шлёт
 *     запросы, заведомо обречённые на 401;
 *   - с секретом она ставит ровно два запроса — outbox и learning — с верным
 *     адресом и заголовком авторизации.
 *
 * Запросы pg_net попадают в очередь в той же транзакции и уходят только после
 * фиксации. Каждый сценарий откатывается, поэтому ни один запрос не отправляется.
 */

const databaseUrl = process.env.DATABASE_URL;
const describeIfConfigured = databaseUrl ? describe : describe.skip;
const rollback = new Error('fixture rollback');

async function scenario(run: (tx: postgres.TransactionSql) => Promise<void>) {
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

async function expectRejected(
  tx: postgres.TransactionSql,
  pattern: RegExp,
  call: () => Promise<unknown>,
) {
  await tx`savepoint before_call`;
  await expect(call()).rejects.toThrow(pattern);
  await tx`rollback to savepoint before_call`;
}

/** Очередь pg_net до вызова — чтобы считать только то, что поставил наш вызов. */
async function queuedIds(tx: postgres.TransactionSql): Promise<Set<number>> {
  const rows = await tx`select id from net.http_request_queue`;
  return new Set(rows.map((row) => Number(row.id)));
}

async function newRequests(tx: postgres.TransactionSql, before: Set<number>) {
  const rows = await tx`select id, method, url, headers from net.http_request_queue order by id`;
  return rows.filter((row) => !before.has(Number(row.id)));
}

describeIfConfigured('планировщик фоновых задач в базе (pg_cron)', () => {
  it('задание расписано на каждые 15 минут', async () => {
    await scenario(async (tx) => {
      const [job] =
        await tx`select schedule, command from cron.job where jobname = 'qajet-drain-queues'`;
      expect(job, 'задание планировщика существует').toBeTruthy();
      expect(job?.schedule).toBe('*/15 * * * *');
      expect(String(job?.command)).toContain('run_scheduled_jobs');
    });
  });

  it('вошедший пользователь не может дёргать фоновые задачи', async () => {
    await scenario(async (tx) => {
      await tx`set local role authenticated`;
      await expectRejected(tx, /permission denied/i, () => tx`select public.run_scheduled_jobs()`);
    });
  });

  it('аноним не может дёргать фоновые задачи', async () => {
    await scenario(async (tx) => {
      await tx`set local role anon`;
      await expectRejected(tx, /permission denied/i, () => tx`select public.run_scheduled_jobs()`);
    });
  });

  it('без секрета в Vault не ставит ни одного запроса', async () => {
    await scenario(async (tx) => {
      // Секрета ещё нет — владелец положит его позже. Запросы, заведомо
      // обречённые на 401, засоряли бы очередь каждые 15 минут.
      const before = await queuedIds(tx);
      await tx`select public.run_scheduled_jobs()`;
      expect(await newRequests(tx, before)).toHaveLength(0);
    });
  });

  it('с секретом ставит ровно два запроса: outbox и learning', async () => {
    await scenario(async (tx) => {
      await tx`select vault.create_secret('test-cron-secret-value', 'qajet_cron_secret')`;
      await tx`select vault.create_secret('https://app.example.test', 'qajet_app_url')`;

      const before = await queuedIds(tx);
      await tx`select public.run_scheduled_jobs()`;
      const queued = await newRequests(tx, before);

      expect(queued, 'ровно две задачи').toHaveLength(2);
      const urls = queued.map((row) => row.url).sort();
      expect(urls).toEqual([
        'https://app.example.test/api/jobs/learning',
        'https://app.example.test/api/jobs/outbox',
      ]);
      for (const row of queued) {
        expect(row.method).toBe('POST');
        const headers = row.headers as Record<string, string>;
        expect(headers.Authorization).toBe('Bearer test-cron-secret-value');
      }
    });
  });

  it('лишний слэш в адресе приложения не ломает путь', async () => {
    await scenario(async (tx) => {
      await tx`select vault.create_secret('s', 'qajet_cron_secret')`;
      await tx`select vault.create_secret('https://app.example.test/', 'qajet_app_url')`;
      const before = await queuedIds(tx);
      await tx`select public.run_scheduled_jobs()`;
      const urls = (await newRequests(tx, before)).map((row) => row.url).sort();
      expect(urls[0]).toBe('https://app.example.test/api/jobs/learning');
    });
  });

  it('секрет читается из Vault, а не зашит в код функции', async () => {
    await scenario(async (tx) => {
      const [fn] = await tx`select prosrc from pg_proc where proname = 'run_scheduled_jobs'`;
      expect(String(fn?.prosrc)).toContain('vault.decrypted_secrets');
      expect(String(fn?.prosrc), 'в коде функции нет значения секрета').not.toMatch(
        /Bearer [A-Za-z0-9]{8,}/,
      );
    });
  });
});
