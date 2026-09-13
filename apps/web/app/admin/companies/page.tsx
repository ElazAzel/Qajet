import { Reveal } from '@qajet/ui/motion';
import { Card } from '@qajet/ui/primitives';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  CompanyCreateForm,
  ResendInviteButton,
  SupplierVerificationActions,
} from './_company-actions';

export default async function AdminCompaniesPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data: companies }, { data: owners }] = await Promise.all([
    supabase
      .from('companies')
      .select('id, type, name, bin, city, verified_at, verification_note, is_active')
      .order('created_at', { ascending: false }),
    supabase
      .from('users')
      .select('id, email, full_name, company_id, role, is_active')
      .eq('role', 'owner'),
  ]);
  const ownerByCompany = new Map((owners ?? []).map((owner) => [owner.company_id, owner]));
  return (
    <div className="flex flex-col gap-6">
      <Reveal>
        <h1 className="text-2xl font-extrabold">Компании и подключения</h1>
        <p className="mt-1 text-fine text-muted">
          Каждое подключение создаётся админом: компания, owner и письмо активации.
        </p>
      </Reveal>
      <Reveal>
        <Card>
          <h2 className="text-base font-bold">Подключить B2B-компанию</h2>
          <CompanyCreateForm />
        </Card>
      </Reveal>
      <Reveal>
        <Card>
          <h2 className="mb-4 text-base font-bold">Реестр компаний</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-fine">
              <thead>
                <tr className="border-b border-rule text-left text-micro text-muted uppercase">
                  <th className="px-2 py-2">Компания</th>
                  <th className="px-2 py-2">Тип</th>
                  <th className="px-2 py-2">Owner</th>
                  <th className="px-2 py-2">Верификация</th>
                  <th className="px-2 py-2">Действия</th>
                </tr>
              </thead>
              <tbody>
                {(companies ?? []).map((company) => {
                  const owner = ownerByCompany.get(company.id);
                  const approved = Boolean(company.verified_at);
                  return (
                    <tr key={company.id} className="border-b border-rule align-top last:border-0">
                      <td className="px-2 py-3">
                        <p className="font-semibold text-ink">{company.name}</p>
                        <p className="text-micro text-muted">
                          БИН {company.bin ?? '—'} · {company.city ?? '—'}
                        </p>
                      </td>
                      <td className="px-2 py-3">
                        {company.type === 'buyer' ? 'Покупатель' : 'Поставщик'}
                      </td>
                      <td className="px-2 py-3">
                        <p>{owner?.full_name ?? '—'}</p>
                        <p className="text-micro text-muted">{owner?.email ?? '—'}</p>
                      </td>
                      <td className="px-2 py-3">
                        {company.type === 'supplier'
                          ? approved
                            ? 'Одобрен'
                            : company.verification_note
                              ? 'Отклонён'
                              : 'На проверке'
                          : '—'}
                        {company.verification_note && (
                          <p className="mt-1 max-w-xs text-micro text-muted">
                            {company.verification_note}
                          </p>
                        )}
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex flex-col items-start gap-2">
                          {company.type === 'supplier' && (
                            <SupplierVerificationActions companyId={company.id} />
                          )}
                          {owner && <ResendInviteButton userId={owner.id} />}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </Reveal>
    </div>
  );
}
