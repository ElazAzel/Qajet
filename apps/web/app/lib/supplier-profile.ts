import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Профиль и портфолио поставщика — agents.md §10 «Поставщик → профиль и
 * портфолио». Маршрута не существовало, пункт навигации был убран как
 * ведущий на 404 (см. комментарий в `apps/web/app/supplier/layout.tsx`).
 *
 * Все колонки давно есть в `supplier_profiles` (categories, capabilities,
 * min_order_kzt, lead_time_days_default, portfolio_urls, notes) и уже
 * читаются матчером при подборе (packages/engine/src/match) — то есть
 * поставщик до сих пор влиял на свою видимость в подборе, но не мог ни
 * увидеть эти значения, ни изменить их. Политика на запись
 * (`supplier_profiles_update_own`) тоже существует с самого начала.
 */

export interface SupplierProfile {
  companyId: string;
  companyName: string;
  bin: string | null;
  categories: string[];
  capabilities: string[];
  minOrderKzt: number | null;
  leadTimeDaysDefault: number | null;
  portfolioUrls: string[];
  notes: string | null;
  /** null → компания ещё не верифицирована админом (§10 «Админ → верификация»). */
  verifiedAt: string | null;
}

export async function loadSupplierProfile(
  supabase: SupabaseClient,
  companyId: string | null,
): Promise<SupplierProfile | null> {
  if (!companyId) return null;

  const [{ data: profile }, { data: company }] = await Promise.all([
    supabase
      .from('supplier_profiles')
      .select(
        'company_id, categories, capabilities, min_order_kzt, lead_time_days_default, portfolio_urls, notes',
      )
      .eq('company_id', companyId)
      .maybeSingle(),
    supabase.from('companies').select('name, bin, verified_at').eq('id', companyId).maybeSingle(),
  ]);
  if (!profile) return null;

  return {
    companyId: profile.company_id,
    companyName: company?.name ?? '—',
    bin: company?.bin ?? null,
    categories: profile.categories ?? [],
    capabilities: profile.capabilities ?? [],
    minOrderKzt: profile.min_order_kzt,
    leadTimeDaysDefault: profile.lead_time_days_default,
    portfolioUrls: profile.portfolio_urls ?? [],
    notes: profile.notes,
    verifiedAt: company?.verified_at ?? null,
  };
}
