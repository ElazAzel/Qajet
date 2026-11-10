import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { findDemoData, readEnvironmentKind, writeClientEnvironment } from '../client-environment';
import { assertDemoDataAllowed, type QajetRequisites } from '../environment';

/**
 * Клиентское окружение: реальные реквизиты в счетах, метка, которая запрещает
 * демо-сид и сброс, и первый админ без пароля из репозитория. Демо-база
 * (локальный сид) обязана распознаваться как непригодная.
 */

const databaseUrl = process.env.DATABASE_URL;
const describeIfConfigured = databaseUrl ? describe : describe.skip;
const rollback = new Error('fixture rollback');

const REQUISITES: QajetRequisites = {
  legalName: 'E2E-client-env ТОО',
  bin: '210140012345',
  address: 'г. Алматы, пр. Абая 1',
  bankName: 'АО "Halyk Bank"',
  iban: 'KZ86125KZT5004100100',
  bik: 'HSBKKZKX',
  phone: '+7 701 000 00 00',
  email: 'billing@example.kz',
};

async function inRolledBackTransaction(run: (tx: postgres.TransactionSql) => Promise<void>) {
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

describeIfConfigured('клиентское окружение', () => {
  it('демо-база распознаётся как непригодная для клиентов', async () => {
    await inRolledBackTransaction(async (tx) => {
      const userId = crypto.randomUUID();
      await tx`insert into auth.users (id, email)
        values (${userId}, ${`E2E-client-env-demo-${userId}@example.test`})`;
      // Own rollback-only row; existing demo profiles are never changed.
      await tx`insert into public.users (id, company_id, email, full_name, role, is_active)
        values (${userId}, null, 'admin@demo.qajet.kz', 'E2E client-env demo marker', 'admin', true)`;
      const reasons = await findDemoData(tx);
      expect(reasons.join('; ')).toMatch(/демо-аккаунты/);
    });
  });

  it('пишет настройки, реальные реквизиты, метку и админа; после метки демо-операции запрещены', async () => {
    await inRolledBackTransaction(async (tx) => {
      const adminId = crypto.randomUUID();
      const email = `E2E-client-env-${adminId.slice(0, 8)}@example.test`;
      await tx`insert into auth.users (id) values (${adminId})`;
      await tx`delete from public.settings`;

      const input = {
        requisites: REQUISITES,
        admin: { id: adminId, email, fullName: 'E2E Админ' },
      };
      await writeClientEnvironment(tx, input);

      const settings = await tx<
        { key: string; value: unknown }[]
      >`select key, value from public.settings`;
      const byKey = new Map(settings.map((row) => [row.key, row.value]));
      expect(byKey.get('commission_rate_pct')).toBe(15);
      expect(byKey.get('rfq_batch_size_per_item')).toBe(5);
      expect(byKey.get('qajet_requisites')).toEqual(REQUISITES);
      const [admin] = await tx<{ role: string; company_id: string | null }[]>`
        select role, company_id from public.users where id = ${adminId}`;
      expect(admin).toEqual({ role: 'admin', company_id: null });

      expect(() => assertDemoDataAllowed(undefined, 'db:reset')).not.toThrow();
      const kind = await readEnvironmentKind(tx);
      expect(() => assertDemoDataAllowed(kind, 'db:reset')).toThrow(/клиентск/);

      // Повтор безопасен и не перетирает параметры, поправленные вживую.
      await tx`update public.settings set value = '12'::jsonb where key = 'commission_rate_pct'`;
      await writeClientEnvironment(tx, input);
      const [rate] = await tx<{ value: unknown }[]>`
        select value from public.settings where key = 'commission_rate_pct'`;
      expect(rate?.value).toBe(12);
      const [admins] = await tx<{ count: number }[]>`
        select count(*)::int as count from public.users where id = ${adminId}`;
      expect(admins?.count).toBe(1);
    });
  });
});
