import { Reveal } from '@qajet/ui/motion';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { CATEGORY_LABEL, type CatalogCategory } from '../../lib/catalog';
import { requireCurrentUser } from '../../lib/current-user';
import { loadSupplierProfile } from '../../lib/supplier-profile';
import { ProfileForm } from './_profile-form';

/**
 * Профиль и портфолио поставщика — agents.md §10. Категории и требуемые
 * навыки показаны как факт (то, по чему его находит матчер), а не как
 * поле формы: изменение этого словаря без согласования с подбором тихо
 * убрало бы поставщика из категорий, где он реально работает.
 */
export default async function SupplierProfilePage() {
  const supabase = await createSupabaseServerClient();
  const user = await requireCurrentUser();
  const profile = await loadSupplierProfile(supabase, user.companyId);

  if (!profile) {
    return (
      <div className="px-4 py-5 sm:px-6 sm:py-6">
        <p className="text-fine text-muted">Профиль поставщика ещё не заведён.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 px-4 py-5 sm:px-6 sm:py-6">
      <Reveal>
        <h1 className="text-2xl font-extrabold">{profile.companyName}</h1>
        <p className="mt-1.5 text-fine text-muted">
          {profile.bin ? `БИН ${profile.bin} · ` : ''}
          {profile.verifiedAt ? 'верифицирован' : 'верификация не пройдена'}
        </p>
      </Reveal>

      <Reveal delay={0.08} className="rounded-card border border-rule bg-surface p-5">
        <h2 className="mb-3 text-base font-bold">Категории и навыки</h2>
        <div className="flex flex-wrap gap-1.5">
          {profile.categories.length === 0 && (
            <p className="text-fine text-muted">Категории не заданы — обратитесь к консьержу.</p>
          )}
          {profile.categories.map((c) => (
            <span
              key={c}
              className="rounded-full bg-purple-10 px-2.5 py-1 text-micro font-semibold text-purple"
            >
              {CATEGORY_LABEL[c as CatalogCategory] ?? c}
            </span>
          ))}
          {profile.capabilities.map((c) => (
            <span
              key={c}
              className="rounded-full bg-page px-2.5 py-1 text-micro font-semibold text-muted"
            >
              {c}
            </span>
          ))}
        </div>
        <p className="mt-3 text-micro text-muted">
          Список категорий и навыков определяет, в каких RFQ вас видит система. Изменить его может
          только консьерж.
        </p>
      </Reveal>

      <Reveal delay={0.14} className="rounded-card border border-rule bg-surface p-5">
        <h2 className="mb-3 text-base font-bold">Условия работы и портфолио</h2>
        <ProfileForm profile={profile} />
      </Reveal>
    </div>
  );
}
