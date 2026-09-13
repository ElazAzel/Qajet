import { Reveal } from '@qajet/ui/motion';
import { Card } from '@qajet/ui/primitives';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireActor } from '../../lib/current-user';
import { SupplierProfileForm } from './_profile-form';

export default async function SupplierProfilePage() {
  const user = await requireActor('supplier');
  const supabase = await createSupabaseServerClient();
  const [{ data: profile }, { data: company }] = await Promise.all([
    supabase
      .from('supplier_profiles')
      .select(
        'categories, capabilities, service_cities, min_order_kzt, lead_time_days_default, portfolio_urls, notes',
      )
      .eq('company_id', user.companyId ?? '')
      .maybeSingle(),
    supabase
      .from('companies')
      .select('name, bin, city, verified_at, verification_note')
      .maybeSingle(),
  ]);

  const initial = {
    categories: (profile?.categories ?? []) as string[],
    capabilities: (profile?.capabilities ?? []) as string[],
    serviceCities: (profile?.service_cities ?? []) as string[],
    minOrderKzt: profile?.min_order_kzt ?? null,
    leadTimeDaysDefault: profile?.lead_time_days_default ?? null,
    portfolioUrls: (profile?.portfolio_urls ?? []) as string[],
    notes: profile?.notes ?? '',
  } as const;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <Reveal>
        <p className="text-micro tracking-wide text-muted uppercase">Поставщик</p>
        <h1 className="mt-1 text-3xl font-extrabold text-ink">Профиль компании</h1>
        <p className="mt-2 text-sm text-muted">
          Эти данные используются для подбора RFQ. Поставщик без подтверждённой верификации не
          попадает в новую рассылку.
        </p>
      </Reveal>
      <Reveal className="mt-6">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3 border-rule border-b pb-4">
            <div>
              <h2 className="text-base font-bold text-ink">{company?.name ?? user.companyName}</h2>
              <p className="mt-1 text-fine text-muted">
                БИН {company?.bin ?? '—'} · {company?.city ?? '—'}
              </p>
            </div>
            <span
              className={`rounded-control px-2.5 py-1 text-micro font-semibold ${company?.verified_at ? 'bg-status-success-bg text-status-success-fg' : 'bg-status-warning-bg text-status-warning-fg'}`}
            >
              {company?.verified_at ? 'Верификация подтверждена' : 'Ожидает проверки'}
            </span>
          </div>
          {company?.verification_note && (
            <p className="mt-3 text-fine text-muted">
              Комментарий QAJET: {company.verification_note}
            </p>
          )}
          <SupplierProfileForm initial={initial} canManage={user.role === 'owner'} />
        </Card>
      </Reveal>
    </div>
  );
}
