import { Reveal } from '@qajet/ui/motion';
import { buttonClass, Card } from '@qajet/ui/primitives';
import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireActor } from '../../lib/current-user';
import { loadEditableSettings } from '../../lib/settings-catalog';
import { SettingRow } from './_setting-row';

/**
 * Параметры экономики — agents.md §9: «стоимость часа закупщика и ставка
 * комиссии — параметры в settings, чтобы на сцене можно было при вопросе
 * жюри поменять цифру и показать пересчёт вживую. Это очень сильный
 * момент». И §10 «Админ → настройка комиссии, базы комиссии, тарифов,
 * запаса калькулятора».
 *
 * Экрана не существовало: `settings` читалась из четырёх мест приложения и
 * не писалась ни из одного, а пункт навигации был убран как ведущий на
 * 404. Поменять цифру можно было только руками в базе — то есть ровно то,
 * что спека называет сильным моментом, на сцене было недоступно.
 */

export default async function AdminSettingsPage() {
  await requireActor('admin');
  const supabase = await createSupabaseServerClient();
  const settings = await loadEditableSettings(supabase);

  return (
    <div>
      <Reveal className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold">Параметры экономики</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Меняются вживую: подбор поставщиков, экран сравнения и юнит-экономика пересчитываются по
            новому значению сразу, без перезапуска.
          </p>
        </div>
        <Link href="/metrics" className={buttonClass('secondary')}>
          Смотреть пересчёт
        </Link>
      </Reveal>

      <Reveal>
        <Card padding="sm">
          <ul className="flex flex-col">
            {settings.map((setting) => (
              <SettingRow key={setting.key} setting={setting} />
            ))}
          </ul>
        </Card>
      </Reveal>

      <Reveal className="mt-4">
        <p className="text-fine text-muted">
          Реквизиты QAJET (<code>qajet_requisites</code>) в этот список намеренно не входят: это
          JSON, а не число, и правится он вместе с юридическими данными, а не в форме параметров.
        </p>
      </Reveal>
    </div>
  );
}
