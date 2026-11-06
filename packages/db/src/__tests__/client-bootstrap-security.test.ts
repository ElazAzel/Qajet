import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import {
  findDemoData,
  requireExistingClientAdmin,
  writeClientEnvironment,
} from '../client-environment';

const url = process.env.DATABASE_URL;
const describeDb = url ? describe : describe.skip;
const rollback = new Error('E2E fixture rollback');
async function fixture(run: (tx: postgres.TransactionSql) => Promise<void>) {
  const sql = postgres(url as string, { max: 1, prepare: false });
  try {
    await sql
      .begin(async (tx) => {
        await run(tx);
        throw rollback;
      })
      .catch((e) => {
        if (e !== rollback) throw e;
      });
  } finally {
    await sql.end();
  }
}
const requisites = {
  legalName: 'E2E operator',
  bin: '210140012345',
  address: 'E2E address',
  bankName: 'E2E bank',
  iban: 'KZ86125KZT5004100100',
  bik: 'HSBKKZKX',
  phone: '+77010000000',
  email: 'billing@example.test',
};
describeDb('client bootstrap does not trust existing auth identities', () => {
  it('generated demo-reset SQL rejects client databases before the first DELETE', async () =>
    fixture(async (tx) => {
      await tx`insert into settings(key,value) values('environment_kind','"clients"'::jsonb) on conflict(key) do update set value=excluded.value`;
      const generated = execFileSync(
        process.execPath,
        ['--import', 'tsx', 'src/scripts/dump-seed-sql.ts'],
        {
          cwd: fileURLToPath(new URL('../../', import.meta.url)),
          encoding: 'utf8',
          maxBuffer: 4 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      const firstDelete = generated.indexOf('delete from');
      expect(firstDelete).toBeGreaterThan(0);
      const precheck = generated.slice(0, firstDelete).replace(/^begin;\s*/, '');
      await expect(tx.savepoint((sp) => sp.unsafe(precheck))).rejects.toThrow(/forbidden/);
      expect((await tx`select value from settings where key='environment_kind'`)[0]?.value).toBe(
        'clients',
      );
    }));
  it('reuses only an established active client administrator', async () =>
    fixture(async (tx) => {
      const uid = crypto.randomUUID(),
        email = `E2E-reuse-${uid}@example.test`;
      await tx`insert into auth.users(id,email) values(${uid},${email})`;
      await expect(requireExistingClientAdmin(tx, uid, email)).rejects.toThrow();
      await tx`insert into public.users(id,role,full_name,email) values(${uid},'admin','E2E admin',${email})`;
      await expect(requireExistingClientAdmin(tx, uid, email)).rejects.toThrow();
      await tx`insert into settings(key,value) values('environment_kind','"clients"'::jsonb) on conflict(key) do update set value=excluded.value`;
      await expect(requireExistingClientAdmin(tx, uid, email)).resolves.toBeUndefined();
      await expect(requireExistingClientAdmin(tx, uid, 'different@example.test')).rejects.toThrow();
      await tx`update public.users set is_active=false where id=${uid}`;
      await expect(requireExistingClientAdmin(tx, uid, email)).rejects.toThrow();
    }));
  it('detects orphan demo auth identities before client provisioning', async () =>
    fixture(async (tx) => {
      const uid = crypto.randomUUID();
      await tx`insert into auth.users(id,email) values(${uid},'admin@demo.qajet.kz')`;
      expect((await findDemoData(tx)).join(';')).toMatch(/демо.*Auth/i);
    }));
  it('rejects an incompatible existing profile before writing client settings', async () =>
    fixture(async (tx) => {
      const uid = crypto.randomUUID(),
        co = crypto.randomUUID(),
        email = `E2E-bootstrap-${uid}@example.test`;
      await tx`insert into companies(id,type,name) values(${co},'buyer','E2E bootstrap')`;
      await tx`insert into auth.users(id,email) values(${uid},${email})`;
      await tx`insert into public.users(id,company_id,role,full_name,email) values(${uid},${co},'manager','E2E manager',${email})`;
      const before = await tx`select key,value from settings order by key`;
      await expect(
        tx.savepoint((sp) =>
          writeClientEnvironment(sp, {
            requisites,
            admin: { id: uid, email, fullName: 'E2E admin' },
          }),
        ),
      ).rejects.toThrow();
      expect(await tx`select key,value from settings order by key`).toEqual(before);
    }));
});
