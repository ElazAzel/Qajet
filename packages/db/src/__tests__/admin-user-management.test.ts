import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

/**
 * Админ QAJET должен уметь заводить, блокировать и править учётные записи.
 * Сейчас этого нет вовсе: есть только «создать компанию с владельцем».
 *
 * Изменение роли и блокировка — операции с повышением привилегий, поэтому
 * проверка живёт ВНУТРИ функции, а не в коде приложения. На таблице users нет
 * ни одной UPDATE-политики для authenticated, и единственной защитой иначе
 * осталась бы дисциплина вызывающего: любой будущий путь, забывший проверку,
 * открыл бы правку ролей.
 *
 * Три запрета, которые тут закреплены, — не украшения, а условия
 * управляемости системы:
 *   1. нельзя действовать на себя (самоблокировка и самопонижение);
 *   2. нельзя убрать последнего активного админа;
 *   3. роль и компания должны быть согласованы: персонал QAJET вне компании,
 *      сотрудник компании — внутри.
 */

const databaseUrl = process.env.DATABASE_URL;
const describeIfConfigured = databaseUrl ? describe : describe.skip;
const rollback = new Error('fixture rollback');

interface World {
  admin: string;
  otherAdmin: string;
  concierge: string;
  buyerOwner: string;
  buyerManager: string;
  inactiveAdmin: string;
  buyerCompany: string;
}

async function scenario(run: (tx: postgres.TransactionSql, w: World) => Promise<void>) {
  const sql = postgres(databaseUrl as string, { max: 1, prepare: false });
  const id = () => crypto.randomUUID();
  try {
    await sql
      .begin(async (tx) => {
        const buyerCo = id();
        const w: World = {
          admin: id(),
          otherAdmin: id(),
          concierge: id(),
          buyerOwner: id(),
          buyerManager: id(),
          inactiveAdmin: id(),
          buyerCompany: buyerCo,
        };
        await tx`insert into companies (id, type, name) values (${buyerCo}, 'buyer', 'E2E-admin buyer')`;
        const people: [string, string | null, string, boolean][] = [
          [w.admin, null, 'admin', true],
          [w.otherAdmin, null, 'admin', true],
          [w.concierge, null, 'concierge', true],
          [w.buyerOwner, buyerCo, 'owner', true],
          [w.buyerManager, buyerCo, 'manager', true],
          [w.inactiveAdmin, null, 'admin', false],
        ];
        for (const [uid] of people) await tx`insert into auth.users (id) values (${uid})`;
        for (const [uid, co, role, active] of people) {
          await tx`insert into public.users (id, company_id, role, full_name, email, is_active)
            values (${uid}, ${co}, ${role}, ${`U-${uid.slice(0, 6)}`}, ${`${uid}@example.test`}, ${active})`;
        }
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

async function asAnon(tx: postgres.TransactionSql) {
  await tx`reset role`;
  await tx`set local role anon`;
  await tx`select set_config('request.jwt.claims', '', true)`;
}

/** Причина проверяется всегда; savepoint оставляет транзакцию пригодной дальше. */
async function expectRejected(
  tx: postgres.TransactionSql,
  pattern: RegExp,
  call: () => Promise<unknown>,
) {
  await tx`savepoint before_call`;
  await expect(call()).rejects.toThrow(pattern);
  await tx`rollback to savepoint before_call`;
}

const activeOf = async (tx: postgres.TransactionSql, userId: string) => {
  await tx`reset role`;
  const [row] = await tx`select is_active, deactivated_at from public.users where id = ${userId}`;
  return row;
};

describeIfConfigured('admin_set_user_active: блокировка учётной записи', () => {
  it('админ блокирует сотрудника, и время блокировки проставляется', async () => {
    await scenario(async (tx, w) => {
      await asUser(tx, w.admin);
      await tx`select public.admin_set_user_active(${w.buyerManager}, false)`;

      const row = await activeOf(tx, w.buyerManager);
      expect(row?.is_active).toBe(false);
      expect(row?.deactivated_at, 'момент блокировки записан').not.toBeNull();
    });
  });

  it('разблокировка снимает и признак, и отметку времени', async () => {
    await scenario(async (tx, w) => {
      await asUser(tx, w.admin);
      await tx`select public.admin_set_user_active(${w.buyerManager}, false)`;
      await tx`select public.admin_set_user_active(${w.buyerManager}, true)`;

      const row = await activeOf(tx, w.buyerManager);
      expect(row?.is_active).toBe(true);
      expect(row?.deactivated_at).toBeNull();
    });
  });

  it('блокировка не удаляет запись: история действий сохраняется', async () => {
    await scenario(async (tx, w) => {
      await asUser(tx, w.admin);
      await tx`select public.admin_set_user_active(${w.buyerOwner}, false)`;
      await tx`reset role`;
      const [row] =
        await tx`select count(*)::int as n from public.users where id = ${w.buyerOwner}`;
      expect(row?.n, 'пользователь остаётся в базе').toBe(1);
    });
  });

  it('админ не может заблокировать сам себя', async () => {
    await scenario(async (tx, w) => {
      await asUser(tx, w.admin);
      await expectRejected(
        tx,
        /сам себя|себе/i,
        () => tx`select public.admin_set_user_active(${w.admin}, false)`,
      );
    });
  });

  it('последнего активного админа заблокировать нельзя', async () => {
    await scenario(async (tx, w) => {
      await asUser(tx, w.admin);
      // Остаётся ровно один активный админ — сам вызывающий.
      await tx`select public.admin_set_user_active(${w.otherAdmin}, false)`;
      await asUser(tx, w.otherAdmin);
      // Заблокированный админ уже ничего не может.
      await expectRejected(
        tx,
        /админ/i,
        () => tx`select public.admin_set_user_active(${w.concierge}, false)`,
      );
    });
  });

  it('консьерж не управляет учётными записями', async () => {
    await scenario(async (tx, w) => {
      await asUser(tx, w.concierge);
      await expectRejected(
        tx,
        /админ/i,
        () => tx`select public.admin_set_user_active(${w.buyerManager}, false)`,
      );
    });
  });

  it('владелец компании не управляет чужими учётными записями', async () => {
    await scenario(async (tx, w) => {
      await asUser(tx, w.buyerOwner);
      await expectRejected(
        tx,
        /админ/i,
        () => tx`select public.admin_set_user_active(${w.buyerManager}, false)`,
      );
    });
  });

  it('заблокированный админ теряет право управлять', async () => {
    await scenario(async (tx, w) => {
      await asUser(tx, w.inactiveAdmin);
      await expectRejected(
        tx,
        /админ/i,
        () => tx`select public.admin_set_user_active(${w.buyerManager}, false)`,
      );
    });
  });

  it('аноним не имеет доступа к функции вовсе', async () => {
    await scenario(async (tx, w) => {
      await asAnon(tx);
      await expectRejected(
        tx,
        /permission denied/i,
        () => tx`select public.admin_set_user_active(${w.buyerManager}, false)`,
      );
    });
  });
});

describeIfConfigured('admin_update_user: правка имени и роли', () => {
  it('админ меняет имя сотрудника', async () => {
    await scenario(async (tx, w) => {
      await asUser(tx, w.admin);
      await tx`select public.admin_update_user(${w.buyerManager}, 'Новое Имя', null)`;
      await tx`reset role`;
      const [row] = await tx`select full_name, role from public.users where id = ${w.buyerManager}`;
      expect(row?.full_name).toBe('Новое Имя');
      expect(row?.role, 'роль без изменений, раз её не передали').toBe('manager');
    });
  });

  it('админ повышает менеджера до владельца компании', async () => {
    await scenario(async (tx, w) => {
      await asUser(tx, w.admin);
      await tx`select public.admin_update_user(${w.buyerManager}, null, 'owner')`;
      await tx`reset role`;
      const [row] = await tx`select role from public.users where id = ${w.buyerManager}`;
      expect(row?.role).toBe('owner');
    });
  });

  it('сотрудника компании нельзя сделать персоналом QAJET', async () => {
    await scenario(async (tx, w) => {
      await asUser(tx, w.admin);
      // У сотрудника есть компания; роли concierge и admin существуют вне компаний.
      await expectRejected(
        tx,
        /компан/i,
        () => tx`select public.admin_update_user(${w.buyerManager}, null, 'admin')`,
      );
    });
  });

  it('персонал QAJET нельзя сделать сотрудником компании', async () => {
    await scenario(async (tx, w) => {
      await asUser(tx, w.admin);
      await expectRejected(
        tx,
        /компан/i,
        () => tx`select public.admin_update_user(${w.concierge}, null, 'owner')`,
      );
    });
  });

  it('админ не может понизить сам себя', async () => {
    await scenario(async (tx, w) => {
      await asUser(tx, w.admin);
      await expectRejected(
        tx,
        /сам себя|себе/i,
        () => tx`select public.admin_update_user(${w.admin}, null, 'concierge')`,
      );
    });
  });

  it('пустое имя не принимается', async () => {
    await scenario(async (tx, w) => {
      await asUser(tx, w.admin);
      await expectRejected(
        tx,
        /имя/i,
        () => tx`select public.admin_update_user(${w.buyerManager}, '   ', null)`,
      );
    });
  });

  it('консьерж не правит учётные записи', async () => {
    await scenario(async (tx, w) => {
      await asUser(tx, w.concierge);
      await expectRejected(
        tx,
        /админ/i,
        () => tx`select public.admin_update_user(${w.buyerManager}, 'Кто-то', null)`,
      );
    });
  });
});
