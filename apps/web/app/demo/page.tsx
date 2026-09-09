import { createSupabaseServerClient } from '@/lib/supabase/server';
import { orderActorFor, requireCurrentUser } from '../lib/current-user';
import { loadDemoData } from './_data';
import { DemoSceneViewer } from './_scene-viewer';

/**
 * /demo — режим сцены (agents.md §13, обязательный пункт readiness §15:
 * «`/demo` проходится за 40 секунд без интернета»). До этой правки
 * маршрута не существовало вообще — docs/state/routes.md его не
 * перечислял, и ни один журнал сессии не фиксировал ни выполнение, ни
 * осознанный отказ от него (нашедшая это аудиторская находка).
 *
 * Восемь сцен спеки дословно — данные реальные (см. _data.ts), не
 * подрисованные. Staff-гейт: сцены 3-6 показывают межпоставщиковую RFQ/
 * КП-логику, которую покупателю видеть нельзя (ADR-0009).
 */
export default async function DemoPage() {
  const user = await requireCurrentUser();
  const actor = orderActorFor(user);
  if (actor !== 'concierge' && actor !== 'admin') {
    return (
      <div className="mx-auto max-w-md px-6 py-20 text-center">
        <p className="text-sm text-muted">
          /demo показывает внутреннюю логику подбора поставщиков — доступно только концьержу и
          админу.
        </p>
      </div>
    );
  }

  const supabase = await createSupabaseServerClient();
  const data = await loadDemoData(supabase);

  return <DemoSceneViewer data={data} />;
}
